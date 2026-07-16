import { onRequestGet, onRequestOptions } from '../functions/api/admin-metrics.js';

export const GET = (request) => onRequestGet({ request, env: process.env });
export const OPTIONS = () => onRequestOptions();
