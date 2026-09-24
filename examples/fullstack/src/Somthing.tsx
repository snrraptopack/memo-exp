import {$routed} from "@memoized-dom/router"


export function Something(){

  const currentRoute = $routed(({ url, services }) => {
      console.log(services)
        return url.pathname
    })

    return (
        <>
            <h1>Hello this is something page</h1>
            <p> route : {currentRoute}</p>
        </>
    )
}




export function Something1(){

  const currentRoute = $routed(({ url }) => {
    console.log("hello")
    return url.pathname
  })

    return (
        <>
            <h1>Hello this is something page</h1>
            <p> route : {currentRoute}</p>
        </>
    )
}
