import { onRequestOptions, onRequestPost } from '../functions/api/report-error.js';

export const POST = (request) => onRequestPost({ request, env: process.env });
export const OPTIONS = () => onRequestOptions();
