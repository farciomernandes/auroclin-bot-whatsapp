import { prompt } from "../prompts/auroclinAgent";
import { promptGpt } from "../prompts/auroclinAgent.GPT";

export function initPrompt(storeName: string, orderCode: string): string {
  return promptGpt
    .replace(/{{[\s]?storeName[\s]?}}/g, storeName)
    .replace(/{{[\s]?orderCode[\s]?}}/g, orderCode)
}