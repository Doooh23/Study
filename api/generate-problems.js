import { onRequestOptions, onRequestPost } from '../functions/api/generate-problems.js';

export const OPTIONS = () => onRequestOptions();
export const POST = (request) => onRequestPost({ request, env: process.env });
