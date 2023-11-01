import { ChatCompletionRequestMessage } from "openai"
import { Message, Whatsapp, create } from "venom-bot"
import { openai } from "./lib/openai"
import { initPrompt } from "./utils/initPrompt"
import { redis } from "./lib/redis"



// https://wa.me/+5583981613615
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
    max_tokens: 200, //256
    messages,
  })

  return completion.data.choices[0].message?.content
}

create({
  session: "auroclin-gpt-1-0",
  disableWelcome: true,
  browserArgs: chromiumArgs,
})
  .then(async (client: Whatsapp) => await start(client))
  .catch((err) => {
    console.log(err)
  })

async function start(client: Whatsapp) {

  client.onMessage(async (message: Message) => {
    console.log(message.body)
    //Ler todas as mensagens antigas e ignorar pro Gpt não ficar doido
    return;
    try {
      if (!message.body || message.isGroupMsg || message.mimetype === "audio" || message.type !== "chat" || message.from == "status@broadcast") {
        return;
      }
  
      const customerPhone = `+${message.from.replace("@c.us", "")}`
      const customerName = message.author
      const customerKey = `customer:${customerPhone}:chat`
      const orderCode = `#sk-${("00000" + Math.random()).slice(-5)}`
  
      // Busca no redis uma conversa existente
      const lastChat = JSON.parse((await redis.get(customerKey)) || "{}")
      console.log('orderCode = ', orderCode)

  
      const customerChat: CustomerChat =
      lastChat?.status === "open"
        ? (lastChat as CustomerChat)
        : {
            status: "open",
            orderCode,
            chatAt: new Date().toISOString(),
            customer: {
              name: customerName,
              phone: customerPhone,
            },
            messages: [
              {
                role: "system",
                content: initPrompt(orderCode),
              },
            ],
            orderSummary: "",
          }
  
    console.debug(customerPhone, "👤", message.body)
  
      customerChat.messages.push({
        role: 'user',
        content: message.body,
      })
  
      const content =
      (await completion(customerChat.messages)) || "Não entendi..."
  
      customerChat.messages.push({
        role: "assistant",
        content,
      })
  
      await client.sendText(message.from, content)
  
      if (
        customerChat.status === "open" &&
        content.match(customerChat.orderCode)
      ) {
        customerChat.status = "closed"
  
        customerChat.messages.push({
          role: "user",
          content:
            "Gere um resumo do atendimento para registro no sistema da auroclin, quem está solicitando é um robô.",
        })
  
        const content =
          (await completion(customerChat.messages)) || "Não entendi..."
  
        console.debug(customerPhone, "📦", content)
  
        customerChat.orderSummary = content
      }
  
      redis.set(customerKey, JSON.stringify(customerChat))
    } catch (error) {
      await client.sendText(message.from, "Não entendi, aguarde um momento e repita sua última mensagem por favor.")
    }

  })
}
