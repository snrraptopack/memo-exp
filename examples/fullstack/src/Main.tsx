import { App } from "../App"
import { Something, Something1 } from "./Somthing"

export function Main() {

  return (
    <main>
      <div>
        <a route-to="/vote">vote</a>
        <a route-to="/something">something</a>
        <a route-to="/something1">something1</a>
      </div>
      <App route="/vote" />
      <Something route="/something" />
      <Something1 route="/something1" />
    </main>
  )
}
