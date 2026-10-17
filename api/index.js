// Vercel serverless entry. Every non-static request is rewritten here
// (see vercel.json) and handled by the same router the local server uses.
export { app as default } from '../server.js';
