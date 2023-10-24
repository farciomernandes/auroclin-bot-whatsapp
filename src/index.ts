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

async function completion(
  messages: ChatCompletionRequestMessage[]
): Promise<string | undefined> {
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    temperature: 0,
    max_tokens: 20, //256
    messages,
  })

  return completion.data.choices[0].message?.content
}
  const storeName = "Auroclin"
  const orderCode = "#sk-12345"

const customerChat: ChatCompletionRequestMessage[]= [{
  role: "system",
  content: initPrompt(storeName, orderCode),
  }]

create({
  session: "auroclin-gpt",
  disableWelcome: true,
})
  .then(async (client: Whatsapp) => await start(client))
  .catch((err) => {
    console.log(err)
  })

async function start(client: Whatsapp) {

  client.onMessage(async (message: Message) => {
    if (!message.body || message.isGroupMsg) return
    console.log('message => ', message);
    const response = (await completion([
      {
        role: "user",
        content: message.body
      }
    ])) || "Não entendi..."
try {
  await client.sendText(message.from, response)
  
} catch (error) {
  console.log("SACA --> ", error);
}
  })
}
