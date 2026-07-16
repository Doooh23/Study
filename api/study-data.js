import { onRequestGet, onRequestOptions, onRequestPut } from '../functions/api/study-data.js';

export const GET = (request) => onRequestGet({ request, env: process.env });
export const PUT = (request) => onRequestPut({ request, env: process.env });
export const OPTIONS = () => onRequestOptions();
