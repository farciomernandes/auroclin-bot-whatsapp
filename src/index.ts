import { ChatCompletionRequestMessage } from "openai"
import { Message, Whatsapp, create } from "venom-bot"
import { openai } from "./lib/openai"
import { redis } from "./lib/redis"
import {
  addHours,
  format,
  isBefore,
  isWithinInterval,
  setHours,
  setMinutes,
  startOfDay,
  subHours,
} from "date-fns"
import { initPrompt } from "./utils/initPrompt"

const formatoDesejado = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"


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
  isDisabledData: any
}

const chromiumArgs = [
  '--disable-web-security', '--no-sandbox', '--disable-web-security',
  '--aggressive-cache-discard', '--disable-cache', '--disable-application-cache',
  '--disable-offline-load-stale-cache', '--disk-cache-size=0',
  '--disable-background-networking', '--disable-default-apps', '--disable-extensions',
  '--disable-sync', '--disable-translate', '--hide-scrollbars', '--metrics-recording-only',
  '--mute-audio', '--no-first-run', '--safebrowsing-disable-auto-update',
  '--ignore-certificate-errors', '--ignore-ssl-errors', '--ignore-certificate-errors-spki-list'
]

async function completion(
  messages: ChatCompletionRequestMessage[]
): Promise<string | undefined> {
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    temperature: 0,
    max_tokens: 180, //256
    messages,
  })

  return completion.data.choices[0].message?.content
}

function shouldIgnoreMessages(): any {
  const timeZoneOffset = 3 * 60; // -3 horas convertidas em minutos
  const dataUtc = new Date();
  const now = new Date(dataUtc.getTime() - timeZoneOffset * 60 * 1000);
  const startMorning = setHours(setMinutes(startOfDay(now), 7), 0);
  const endMorning = setHours(setMinutes(startOfDay(now), 12), 0);
  const startAfternoon = setHours(setMinutes(startOfDay(now), 14), 0);
  const endAfternoon = setHours(setMinutes(startOfDay(now), 17), 0);
  const isIgnore = (
    isWithinInterval(now, { start: startMorning, end: endMorning }) ||
    isWithinInterval(now, { start: startAfternoon, end: endAfternoon })
  )

  return {
    isIgnore,
    dataAtual: now
  };
}

async function saveCustomerChat(
  client: Whatsapp,
  message: Message,
  customerName: string,
  orderCode: string
) {
  const customerPhone = `+${message.from.replace("@c.us", "")}`
  const customerKey = `customer:${customerPhone}:chat`
  const tempoDeExpiracaoEmSegundos = 3 * 60 * 60
  const { isIgnore, dataAtual } = shouldIgnoreMessages();

  try {
    
    console.log('mensagem --> ', message.body)

    if (isIgnore) {
      console.log('Mensagens sendo ignoradas devido ao horário.')
      return
    }

    // Busca no Redis uma conversa existente
    const lastChat = JSON.parse((await redis.get(customerKey)) || "{}")

    let customerChat: CustomerChat = lastChat?.status === "open"
      ? (lastChat as CustomerChat)
      : {
        status: "open",
        orderCode,
        chatAt: format(subHours(dataAtual, 6), formatoDesejado),
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
        isDisabledData: dataAtual,
      }

    // Verifica se a conversa está dentro do prazo que deve estar pausada para o bot
    const isDataPassada = isBefore(dataAtual, new Date(customerChat.isDisabledData));

    if (isDataPassada) {
      console.log('Mensagens sendo ignoradas devido ao período de pausa.')
      return
    }

    console.debug(customerPhone, "👤", message.body)

    customerChat.messages.push({
      role: 'user',
      content: message.body,
    })

    // Envia a pergunta com o contexto para o chatGpt
    const content = (await completion(customerChat.messages)) || "Não entendi..."

    customerChat.messages.push({
      role: "assistant",
      content,
    })

    // Responde a mensagem
    await client.sendText(message.from, content)

    // Caso seja enviado um orderCode, encerra o contexto e pede para um atendente continuar
    if (content.match(customerChat.orderCode) || content.match('Agendei') || content.match('Agendado') || content.match('agendei') || content.match('agendado')) {

      customerChat.messages.push({
        role: "user",
        content:
          "Gere um resumo do atendimento para registro no sistema da auroclin, quem está solicitando é um robô.",
      })

      const summaryContent = `Olá, o cliente ${orderCode} precisa de uma atendente para finalizar seu agendamento!`

      console.debug(customerPhone, "📦", summaryContent)

      customerChat.orderSummary = summaryContent
      // Avisa para o grupo que um contato precisa de uma atendente para finalizar o agendamento
      await client.sendText('120363197087635017@g.us', summaryContent)

      // Adiciona 3 horas à data e hora atual para que o bot ignore essa conversa
      customerChat.isDisabledData = addHours(dataAtual, 3)

      redis.set(customerKey, JSON.stringify(customerChat))
      redis.expire(customerKey, tempoDeExpiracaoEmSegundos)
    }

    redis.set(customerKey, JSON.stringify(customerChat))
    redis.expire(customerKey, tempoDeExpiracaoEmSegundos)

  } catch (error) {
    let customerChat = JSON.parse((await redis.get(customerKey)) || "{}")

    const content = `*Olá, houve um erro no atendimento ao cliente ${orderCode}, alguma uma atendente para se comunicar com ele!*`

    // Adiciona 6 horas à data e hora atual
    const dataHoraFormatada = addHours(dataAtual, 3)

    await client.sendText('120363197087635017@g.us', content)

    // Seta o novo período de tempo que o bot deve ignorar a conversa
    customerChat.isDisabledData = dataHoraFormatada;

    redis.set(customerKey, JSON.stringify(customerChat))
    redis.expire(customerKey, tempoDeExpiracaoEmSegundos)

    console.log(error)
  }
}

create({
  session: "auroclin-gpt-1-1",
  disableWelcome: true,
  browserArgs: chromiumArgs,
})
  .then(async (client: Whatsapp) => {
    client.onMessage(async (message: Message) => {
      console.log(message.body);

      if (!message.body || message.isGroupMsg || message.mimetype === "audio" || message.type !== "chat" || message.from == "status@broadcast") {
        return
      }
      
      const customerName = message.author
      const orderCode = message.sender.id.slice(0, -5)
      await saveCustomerChat(client, message, customerName, orderCode)
    })
  })
  .catch((err) => {
    console.log(err)
  })
