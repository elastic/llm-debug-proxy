import express, { Request, Response } from 'express';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { PassThrough } from 'stream';
import type OpenAI from 'openai';
import { formatRequestBody, formatResponseBody, parseTargetUrl } from './formatters';

const app = express();
const PORT = 3000;

app.post('/', (req: Request, res: Response) => {
  const targetUrlParam = req.query.target_url as string;
  const targetUrl = parseTargetUrl(targetUrlParam);
  if (!targetUrl) {
    res.status(400).send('Invalid target_url query parameter');
    return;
  }

  // Setup options for the outbound request
  const options = {
    method: req.method,
    headers: { ...req.headers, host: targetUrl.host },
  };

  // Create the outbound HTTPS request
  const request = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const proxyReq = request(targetUrl, options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);

    let allResponseChunks = '';
    const responsePassThrough = new PassThrough();
    responsePassThrough.on('data', (chunk: Buffer) => {
      allResponseChunks += chunk.toString()
    });

    responsePassThrough.on('end', () => {
      try {
        console.log(`────────────────────────────────────────────────────
🌍  Target URL: ${targetUrl}
────────────────────────────────────────────────────\n`)
        const interceptorName = res.getHeader('Elastic-Interceptor')
        if (interceptorName) {
          console.log(`🚀  Interceptor: ${interceptorName || 'N/A'}`)
        }

        const { statusCode, statusMessage } = proxyRes;
        const statusIcon = statusCode !== 200 ? '❌️' : '✅️';
        console.log(`${statusIcon} ${statusCode} ${statusMessage}`);

        console.log(''); // Add a newline for readability
        console.log('===== Request Body =====');
        console.log(formatRequestBody(requestData), '\n');

        console.log(`===== Response Body =====`);
        console.log(formatResponseBody(res, allResponseChunks));
      } catch (e) {
        console.log('Error:', e)
      }
    });

    proxyRes.pipe(responsePassThrough).pipe(res);
  });

  proxyReq.on('error', (error) => {
    console.error('Proxy request error:', error);
    res.status(500).send('Error forwarding the request');
  });

  // Capture the request data
  const requestPassThrough = new PassThrough();
  let requestData = '';
  requestPassThrough.on('data', (chunk) => {
    requestData += chunk.toString();
  });

  req.pipe(requestPassThrough).pipe(proxyReq);
});

app.all('*', (req: Request, res: Response) => {
  console.log(`Hitting catch all route: ${req.method} ${req.path}`);
  res.send('Noting to see here. Try POST /chat/completions')
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


