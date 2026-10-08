import { App } from "../App"
import { Something, Something1 } from "./Somthing"
export function Main() {


  return (
    <main route="/">
      <div>
        <a route-to="/">vote</a>
        <a route-to="/something">something</a>
        <a route-to="/something1">something1</a>
      </div>
      <App route="/" />
      <Something route="/something" />
      <Something1 route="/something1" />
      <div route="/*">
        <p> does not exist</p>
      </div>
    </main>
  )
}
