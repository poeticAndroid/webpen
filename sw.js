const root = location.toString().slice(0, location.toString().lastIndexOf("/") + 1)
console.log("Starting service worker", location.pathname, "root", root)

addEventListener("fetch", async (event) => {
  let method = ("" + event.request.method).toLowerCase()
  let url = "" + event.request.url
  url = url.split("?")[0]
  url = url.split("#")[0]
  if (!url.includes(root)) method = "delete"
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

let ws, user, room
let manifest = {}

async function generateManifest() {
  let keys = await cache.keys()
  for (let req of keys) {
    let entry = manifest[req.url] = manifest[req.url] || {}
    let resp = await cache.match(req.url)
    console.log("req", req, "resp", resp)
  }
}
generateManifest()

// Create WebSocket connection.
ws = new WebSocket("wss://hotater-eu.onrender.com/ws/chat")
ws.addEventListener("open", (event) => {
  send({ type: "user", name: "webpen" })
})

// Listen for messages
ws.addEventListener("message", (event) => {
  let msg = JSON.parse(event.data)
  console.log("Message from server ", msg)
  switch (msg.type) {
    case "user":
      user = msg
      sendHashKey()
      break;

    case "topic":
      for (let roomId in msg.rooms) {
        return send({ type: "room", id: roomId })
      }
      send({ type: "room", name: "party" })
      break;

    case "room":
      room = msg
      break;

    case "msg":
      // print(room.users[msg.from].name + ": " + msg.content)
      break;

    case "obj":
      clearTimeout(manifest[msg.id]?.pendingUpload)
      // mouse(msg)
      break;

    case "feedme":
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
})

// Connection closed
ws.addEventListener("close", e => {
  console.warn(e)
})

function send(msg) {
  ws.send(JSON.stringify(msg))
}

async function sendHashKey() {
  const encoder = new TextEncoder()
  const data = encoder.encode(user.id + "@" + location.protocol + "//" + location.host + "/duYJOCPvJ2oIvlzX0TgxGGVLTsjM2oDQ")
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data))
  let hex = ""
  for (let byte of hash) hex += byte.toString(16).padStart(2, "0")
  send({ type: "topic", key: hex })
}
