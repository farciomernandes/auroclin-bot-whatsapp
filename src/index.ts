import { ChatCompletionRequestMessage } from "openai"
import { Message, Whatsapp, create } from "venom-bot"
import { openai } from "./lib/openai"
import { initPrompt } from "./utils/initPrompt"



// https://wa.me/+5512982754592
interface CustomerChat {
  status?: "open" | "closed"
  orderCode: string
  chatAt: string
  customer: {
    name: string
    phone: string
  }
  messages: ChatCompletionRequestMessage[]
  orderSummary?: string
}
const storeName = "Auroclin"
const orderCode = "#sk-12345"

const customerChat: ChatCompletionRequestMessage[]= [{
role: "system",
content: initPrompt(storeName, orderCode),
}]

const chromiumArgs = [
  '--disable-web-security', '--no-sandbox', '--disable-web-security',
  '--aggressive-cache-discard', '--disable-cache', '--disable-application-cache',
  '--disable-offline-load-stale-cache', '--disk-cache-size=0',
  '--disable-background-networking', '--disable-default-apps', '--disable-extensions',
  '--disable-sync', '--disable-translate', '--hide-scrollbars', '--metrics-recording-only',
  '--mute-audio', '--no-first-run', '--safebrowsing-disable-auto-update',
  '--ignore-certificate-errors', '--ignore-ssl-errors', '--ignore-certificate-errors-spki-list'
];


async function completion(
  messages: ChatCompletionRequestMessage[]
): Promise<string | undefined> {
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    temperature: 0,
    max_tokens: 150, //256
    messages,
  })

  return completion.data.choices[0].message?.content
}

create({
  session: "auroclin-gpt21",
  disableWelcome: true,
  browserArgs: chromiumArgs,
})
  .then(async (client: Whatsapp) => await start(client))
  .catch((err) => {
    console.log(err)
  })

async function start(client: Whatsapp) {

  client.onMessage(async (message: Message) => {
    if (!message.body || message.isGroupMsg || message.mimetype === "audio" || message.type !== "chat" || message.from == "status@broadcast") {
      return;
    }
    console.log('message => ', message);
    
    customerChat.push({
      role: 'user',
      content: message.body,
    })

    const response = await completion(customerChat) || "Não entendi..."

    customerChat.push({
      role: 'assistant',
      content: response,
    })

    await client.sendText(message.from, response)
  })
}
