import { onRequestOptions, onRequestPost } from '../functions/api/enrich-word.js';

export const OPTIONS = () => onRequestOptions();
export const POST = (request) => onRequestPost({ request, env: process.env });
