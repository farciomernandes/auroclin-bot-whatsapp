import { prompt } from "../prompts/auroclinAgent";
import { promptGpt } from "../prompts/auroclinAgent.GPT";

export function initPrompt(orderCode: string): string {
  return promptGpt.replace(/{{[\s]?orderCode[\s]?}}/g, orderCode)
}