/* eslint-disable @typescript-eslint/no-explicit-any */
import express from 'express';
import { omit } from 'lodash';
import OpenAI from 'openai';
import { URL } from 'url';
import { CliOptions } from './cli';

export function parseTargetUrl(targetUrlParam: string | undefined) {
  if (!targetUrlParam) {
    console.log('target_url query parameter is required');
    return;
  }

  const decodedUrl = decodeURIComponent(targetUrlParam);
  try {
    return new URL(decodedUrl);
  } catch (e) {
    console.log(`target_url query parameter is invalid: "${decodedUrl}"`);
    return;
  }
}

export function formatResponseBody({
  res,
  allResponseChunks,
  cliOptions,
}: {
  res: express.Response;
  allResponseChunks: string;
  cliOptions: CliOptions;
}) {
  if (cliOptions.raw) {
    return allResponseChunks;
  }

  const isStreamedResponse =
    res.getHeader('content-type') === 'text/event-stream' ||
    res.getHeader('transfer-encoding') === 'chunked';
  if (!isStreamedResponse) {
    try {
      return JSON.stringify(JSON.parse(allResponseChunks), null, 2);
    } catch (e) {
      return allResponseChunks;
    }
  }

  const lines = allResponseChunks
    .split(/\r?\n/) // Handle both \n and \r\n
    .map((line) => line.trim());

  const hasSSEChunks = lines.some((line) => line.startsWith('data:'));

  console.log(`Chunks: ${allResponseChunks.length}`);
  console.log(`Lines: ${lines.length}`);
  console.log(`Server-sent events (SSE): ${hasSSEChunks.valueOf()}`);
  console.log(`-----\n`);

  if (!hasSSEChunks) {
    return lines
      .map((line) => {
        try {
          const parsedLine = JSON.parse(line);
          return parsedLine.message.content;
        } catch (e) {
          return line;
        }
      })
      .join('');
  }

  const parsedSSEChunks = lines
    .filter((line) => line.startsWith('data:') && line !== 'data: [DONE]') // Filter out non-data and [DONE]
    .map((line) => JSON.parse(line.slice(5).trim()));

  const isOpenAIChunk = parsedSSEChunks.some(
    (chunk) => chunk.object === 'chat.completion.chunk' && chunk.choices,
  );
  if (!isOpenAIChunk) {
    return JSON.stringify(parsedSSEChunks, null, 2);
  }

  const mergedMessage = mergeOpenAIChunks(parsedSSEChunks);
  return JSON.stringify(mergedMessage, null, 2);
}

export function formatRequestBody({
  requestData,
  cliOptions,
}: {
  requestData: string;
  cliOptions: CliOptions;
}) {
  try {
    const parsed = JSON.parse(
      requestData,
    ) as OpenAI.Chat.ChatCompletionCreateParams;
    if (cliOptions.tools === 'none') {
      return JSON.stringify(omit(parsed, 'tools'), null, 2);
    } else if (cliOptions.tools === 'name') {
      const toolNames = parsed.tools?.map((tool) =>
        tool.type === 'function' ? tool.function.name : tool.type,
      ); // only show tool names
      const output = { ...parsed, tools: toolNames };
      return JSON.stringify(output, null, 2);
    }
    return JSON.stringify(parsed, null, 2);
  } catch (e: any) {
    console.error(`Error parsing request data: ${e.message}\n`);
    return requestData;
  }
}

interface UnvalidatedMessage {
  content: string;
  tool_calls: NonNullable<
    OpenAI.ChatCompletionChunk['choices'][0]['delta']['tool_calls']
  >;
}

export const mergeOpenAIChunks = (chunks: OpenAI.ChatCompletionChunk[]) => {
  const message = chunks.reduce<UnvalidatedMessage>(
    (prev, chunk) => {
      const delta = chunk.choices[0]?.delta ?? {};

      prev.content += delta?.content ?? '';
      delta.tool_calls?.forEach((toolCall) => {
        let prevToolCall = prev.tool_calls[toolCall.index];
        if (!prevToolCall) {
          prev.tool_calls[toolCall.index] = {
            function: {
              name: '',
              arguments: '',
            },
            index: 0,
            id: '',
          };

          prevToolCall = prev.tool_calls[toolCall.index];
        }

        // @ts-expect-error
        prevToolCall.function.name += toolCall.function.name ?? '';
        // @ts-expect-error
        prevToolCall.function.arguments += toolCall.function.arguments ?? '';
        prevToolCall.index += toolCall.index ?? '';
        prevToolCall.id += toolCall.id ?? '';
      });

      return prev;
    },
    { content: '', tool_calls: [] },
  );

  return message;
};
