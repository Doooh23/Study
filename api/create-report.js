import { onRequestOptions, onRequestPost } from '../functions/api/create-report.js';

export const POST = (request) => onRequestPost({ request, env: process.env });
export const OPTIONS = () => onRequestOptions();
