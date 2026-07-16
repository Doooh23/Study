import { onRequestOptions, onRequestPost } from '../functions/api/evaluate-analysis.js';

export const OPTIONS = () => onRequestOptions();
export const POST = (request) => onRequestPost({ request, env: process.env });
