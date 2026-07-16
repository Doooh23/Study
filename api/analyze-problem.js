import { onRequestOptions, onRequestPost } from '../functions/api/analyze-problem.js';

export const OPTIONS = () => onRequestOptions();
export const POST = (request) => onRequestPost({ request, env: process.env });
