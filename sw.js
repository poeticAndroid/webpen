console.log("Starting service worker", location.pathname)

addEventListener("fetch", async (event) => {
  let method = ("" + event.request.method).toLowerCase()
  let url = "" + event.request.url
  url = url.split("?")[0]
  url = url.split("#")[0]
  console.log("Fetch detected:", method, url)

  switch (method) {
    case "get":
      event.respondWith(handleGet(url))
      break

    case "put":
      event.respondWith(handlePut(url, event.request.arrayBuffer(), event.request.headers.contentType))
      break

    case "delete":
      event.respondWith(handleDelete(url))
      break

    default:
      event.respondWith(new Response("Method not allowed!", { status: 405 }))
  }
})

async function handleGet(url) {
  let cache = await caches.open(location.pathname)

  if (url.slice(-1) == "/") {
    let keys = await cache.keys()
    let entries = []
    for (let req of keys) {
      let entry = req.url
      if (entry.includes(url)) {
        entry = entry.replace(url, "")
        if (entry.includes("/")) {
          entry = entry.split("/")[0] + "/"
        }
        if (entry && !entries.includes(entry)) entries.push(entry)
      }
    }
    entries = entries.sort()
    let html = `<style>@media (prefers-color-scheme: dark) {\n`
    html += `html { background-color: #111; color: #eee; }\n`
    html += `a, a:link { color: #9cf; }\n`
    html += `a:visited { color: #cf9; }}</style>\n`
    html += `<h1>${url}</h1><ul><li><a href="../">../</a></li>\n`
    for (let entry of entries) {
      html += `<li><a href="${entry}">${entry}</a></li>\n`
    }
    html += `</ul>`
    return new Response(html, { headers: { "Content-Type": "text/html" } })
  } else {
    let resp = await cache.match(url)

    if (resp?.ok) {
      return resp
    } else {
      await cache.add(url)
      resp = await cache.match(url)

      if (resp?.ok) {
        return resp
      } else {
        return new Response("Not found!", { status: 404 })
      }
    }
  }
}

async function handlePut(url, body, type) {
  let cache = await caches.open(location.pathname)
  if (!type) {
    let ext = url.slice(url.lastIndexOf(".") + 1).toLowerCase()
    switch (ext) {
      case "html":
      case "css":
        type = "text/" + ext
        break

      case "js":
        type = "text/javascript"
        break

      case "png":
      case "gif":
      case "jpeg":
      case "svg":
        type = "image/" + ext
        break

      default:
        type = "application/" + ext
        break
    }
  }

  if (url.slice(-1) == "/") {
    return new Response("Cannot write to directory!", { status: 400 })
  } else {
    await cache.put(url, new Response(await body, { headers: { "Content-Type": type } }))
    return new Response("File written!")
  }
}

async function handleDelete(url) {
  let cache = await caches.open(location.pathname)

  if (url.slice(-1) == "/") {
    return new Response("Cannot delete directory!", { status: 400 })
  } else {
    cache.delete(url)
    return new Response("File deleted!", { status: 200 })
  }
}


/* sync */

let user, room
// Create WebSocket connection.
const ws = new WebSocket(location.protocol.replace("http", "ws") + "//" + location.host + "/ws/chat")

ws.addEventListener("open", (event) => {
  send({ type: "user", name: params.get("name") })
})

// Listen for messages
ws.addEventListener("message", (event) => {
  let msg = JSON.parse(event.data)
  // console.log("Message from server ", msg)
  switch (msg.type) {
    case "user":
      console.log(msg)
      user = msg
      sendHashKey()
      break;

    case "topic":
      console.log(msg)
      for (let roomId in msg.rooms) {
        return send({ type: "room", id: roomId })
      }
      send({ type: "room", name: "party", store_obj: 42 })
      break;

    case "room":
      console.log(msg)
      room = msg
      room._usernames = []
      for (let id in room.users) {
        room._usernames.push(room.users[id].name)
      }
      print("present are " + JSON.stringify(room._usernames))
      break;

    case "msg":
      print(room.users[msg.from].name + ": " + msg.content)
      break;

    case "obj":
      mouse(msg)
      break;

    case "feedme":
      console.log(msg)
      fetch(msg.url)
      break;

    default:
      console.error("I dunno what to do with", msg)
      break;
  }
})

// Connection error
ws.addEventListener("eror", e => {
  console.error(e)
  print("Conntection error!")
})

// Connection closed
ws.addEventListener("close", e => {
  console.warn(e)
  print("Disconnected..")
})

if (location.search)
  document.querySelector("form").addEventListener("submit", e => {
    e.preventDefault()
    if (!room) return;
    let userInp = document.getElementById("userInp").value
    send({ type: "msg", to: "all", content: userInp })
    document.getElementById("userInp").value = ""
  })
else print("Enter username:")

document.body.addEventListener("mousemove", e => {
  if (!room) return;
  send({ type: "obj", id: pointer_id, mouse: { x: e.pageX + 1, y: e.pageY + 1, c: color } })
})

function print(str, eol = "\n") {
  document.getElementById("output").textContent += str + eol
  setTimeout(() => { scrollBy(0, 1024) }, 32)
}
function send(msg) {
  ws.send(JSON.stringify(msg))
}

function mouse(msg) {
  if (msg.from == user.id) pointer_id = msg.id
  let el = document.getElementById("mouse_" + msg.from)
  if (!el) {
    el = document.createElement("div")
    el.id = "mouse_" + msg.from
    el.classList.add("mouse")
    document.body.appendChild(el)
  }
  el.style.left = `${msg.mouse.x}px`
  el.style.top = `${msg.mouse.y}px`
  el.style.background = msg.mouse.c
}

async function sendHashKey() {
  const encoder = new TextEncoder()
  const data = encoder.encode(user.id + "@" + location.protocol + "//" + location.host + "/secret_key")
  const hash = new Uint8Array(await window.crypto.subtle.digest("SHA-256", data))
  let hex = ""
  for (let byte of hash) hex += byte.toString(16).padStart(2, "0")
  send({ type: "topic", key: hex })
}
