import { ChatCompletionRequestMessage } from "openai"
import { Message, Whatsapp, create } from "venom-bot"
import { openai } from "./lib/openai"
import { initPrompt } from "./utils/initPrompt"
import { redis } from "./lib/redis"
import { addHours, format, isAfter, isBefore, parseISO } from "date-fns"

const formatoDesejado = 'dd:MM:yy HH:mm:ss';


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
  isDisabledData: string | null;
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
    max_tokens: 180, //256
    messages,
  })

  return completion.data.choices[0].message?.content
}

create({
  session: "auroclin-gpt-1-1",
  disableWelcome: true,
  browserArgs: chromiumArgs,
})
  .then(async (client: Whatsapp) => await start(client))
  .catch((err) => {
    console.log(err)
  })

async function start(client: Whatsapp) {

  client.onMessage(async (message: Message) => {

    console.log('mensagem --> ', message.body);
    const dataAtual = new Date();
    const cellPhone = message.sender.id;
    const orderCode = cellPhone.slice(0, -5);
    const customerPhone = `+${message.from.replace("@c.us", "")}`
    const customerKey = `customer:${customerPhone}:chat`
    const tempoDeExpiracaoEmSegundos = 3 * 60 * 60; // 3 horas em segundos

    try {
    
      if (!message.body || message.isGroupMsg || message.mimetype === "audio" || message.type !== "chat" || message.from == "status@broadcast") {
        return;
      } 

      const customerName = message.author
      const dataAtual = new Date();
''      
      // Busca no redis uma conversa existente
      const lastChat = JSON.parse((await redis.get(customerKey)) || "{}")

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
            isDisabledData: null,
          }

          //Verifica se a conversa está dentro do prazo que deve estar pausada para o bot
          if(customerChat.isDisabledData){
            const isDataPassada = isBefore(
              parseISO(customerChat.isDisabledData),
              dataAtual
            );
            if (!isDataPassada) {
              return
            }

          }
         
      console.debug(customerPhone, "👤", message.body)
  
      customerChat.messages.push({
        role: 'user',
        content: message.body,
      })
  

      //Envia a pergunta com o contexto para o chatGpt
      const content =
      (await completion(customerChat.messages)) || "Não entendi..."
  
      customerChat.messages.push({
        role: "assistant",
        content,
      })
  
      //Usar em testes -> await client.sendText('5583981613615@g.us', content)

      //Responde a mensagem
      await client.sendText(message.from, content)


      //Caso seja enviado um orderCode encerra o contexto e pede para um atendente continuar
      if (content.match(customerChat.orderCode)) {
        customerChat.status = "closed"
  
        customerChat.messages.push({
          role: "user",
          content:
            "Gere um resumo do atendimento para registro no sistema da auroclin, quem está solicitando é um robô.",
        })

        const content = `Olá, o cliente ${orderCode} precisa de uma atendente para finalizar seu agendamento!`
  
        console.debug(customerPhone, "📦", content)
  
        customerChat.orderSummary = content
        //Avisa para o grupo que um contato precisa de uma atendente para finalizar o agendamento
        await client.sendText('120363197087635017@g.us', content);
        
        
        // Usar para testes -> await client.sendText('5583981613615@g.us', content)

        // Adiciona 3 horas à data e hora atual para que o bot ignore essa conversa
        customerChat.isDisabledData = addHours(dataAtual, 3).toISOString();
        redis.set(customerKey, JSON.stringify(customerChat))
        redis.expire(customerKey, tempoDeExpiracaoEmSegundos);

      }
  
      redis.set(customerKey, JSON.stringify(customerChat))
      redis.expire(customerKey, tempoDeExpiracaoEmSegundos);

    } catch (error) {
      const customerChat = JSON.parse((await redis.get(customerKey)) || "{}")

      const content = `Olá, houve um erro no atendimento ao cliente ${orderCode}, alguma uma atendente para se comunicar com ele!`

      // Adiciona 2 horas à data e hora atual
      const dataHoraFormatada = addHours(dataAtual, 3);

      await client.sendText('5583981613615@g.us', content);
      
      //Usar para teste -> await client.sendText('5583981613615@g.us', content)

      const dataHoraFormatadaString = format(dataHoraFormatada, formatoDesejado);


      //Seta o novo período de tempo que o bot deve ignorar a conversa
      customerChat.isDisabledData = dataHoraFormatadaString;

      redis.set(customerKey, JSON.stringify(customerChat))
      redis.expire(customerKey, tempoDeExpiracaoEmSegundos);

      console.log(error)

    }
  })
}
