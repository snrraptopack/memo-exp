import {optimistic} from "@memoized-dom/utils"
import { deliverMessage } from "./action";

type Message = {
   text:string,sending:boolean,key:string
}

type ThreadProps = {
  messages:Message[],
}

function Thread({ messages }: ThreadProps) {

  const opSendMessage = optimistic({
    action: (field: FormData) => deliverMessage(field.get("message") as string ?? ""),

    apply(field, operationId) {
      const message = field.get("message") as string ?? ""
      messages.push({ key: operationId, text: message, sending: true })

      return () => {
          const i = messages.findIndex(m => m.key === operationId);
          if (i !== -1) messages.splice(i, 1);
      }
    },
    reconcile(saved, _field, operationId) {
        const i = messages.findIndex(m => m.key === operationId);
        if (i !== -1) messages[i] = { text: saved, sending: false, key: operationId };
      },
  })

  const form = $forms(opSendMessage)


  return (
    <>
      {messages.map((message, _index) => (
        <div key={message.key}>
          {message.text}
          {!!message.sending && <small> (Sending...)</small>}
        </div>
      ))}
      <form onSubmit={(e: SubmitEvent) => {
        form.submit(e)
        if(e.currentTarget instanceof HTMLFormElement)e.currentTarget.reset()
      }}>
        <input type="text" name="message" placeholder="Hello!" />
        <button type="submit">Send</button>
        {form.errors && form.errors.map(it => {
          console.log(form.errors)
          return (<p>{ it.kind === "parse" ? "parse error" : it.message}</p>)
        })}
      </form>
    </>
  );
}

export  function App() {
  const messages = [{ text: "Hello there!", sending: false, key: "1" }]

  return <Thread messages={messages}/>;
}
