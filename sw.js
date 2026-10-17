const root = location.toString().slice(0, location.toString().lastIndexOf("/") + 1)
console.log("Starting service worker", location.pathname, "root", root)

addEventListener("fetch", async (event) => {
  let method = ("" + event.request.method).toLowerCase()
  let url = "" + event.request.url
  if (!url.includes(root)) return event.respondWith(fetch(event.request))
  url = url.split("?")[0]
  url = url.split("#")[0]
  console.log("Fetch detected:", method, url)

  switch (method) {
    case "get":
      event.respondWith(handleGet(url))
      break

    case "put":
      event.respondWith(handlePut(url, event.request.bytes(), event.request.headers.contentType))
      break

    case "delete":
      event.respondWith(handleDelete(url))
      break

    default:
      event.respondWith(new Response("Method not allowed!", { status: 405 }))
  }
})

async function handleGet(url) {
  url = url.split("?")[0]
  url = url.split("#")[0]
  if (url == root + "sync.json") return
  let cache = await caches.open(location.pathname)

  if (url.slice(-1) == "/") {
    while (!manifest.isComplete) await sleep(32)
    let folders = [], files = []
    for (let entry in manifest) {
      if (entry.includes(url) && manifest[entry]?.size) {
        entry = entry.replace(url, "")
        if (entry.includes("/")) {
          entry = entry.split("/")[0] + "/"
          if (!folders.includes(entry)) folders.push(entry)
        } else if (entry && !files.includes(entry)) {
          files.push(entry)
        }
      }
    }
    folders = folders.sort()
    files = files.sort()
    let html = `<!DOCTYPE html><style>@media (prefers-color-scheme: dark) {\n`
    html += `html { background-color: #111; color: #eee; }\n`
    html += `a, a:link { color: #9cf; }\n`
    html += `a:visited { color: #cf9; }}</style>\n`
    html += `<h1>${url}</h1><table><tr><th>Name</th><th>Size</th><th>Modified</th></tr>`
    html += `<tr><td><a href="../">../</a></td></tr>\n`
    for (let entry of folders) {
      html += `<tr>\n`
      html += `<td><a href="${entry}">${entry}</a></td>\n`
      html += `</tr>\n`
    }
    for (let entry of files) {
      html += `<tr>\n`
      html += `<td><a href="${entry}">${entry}</a></td>\n`
      html += `<td>${manifest[url + entry]?.size ? manifest[url + entry]?.size + " bytes" : ""}</td>\n`
      html += `<td>${manifest[url + entry]?.modified ? manifest[url + entry]?.modified : ""}</td>\n`
      html += `</tr>\n`
    }
    html += `</table>`
    return new Response(html, { headers: { "Content-Type": "text/html" } })
  } else {
    let resp = await cache.match(url)

    if (resp?.ok && parseInt(resp.headers.get("Content-Length"))) {
      return resp
    } else {
      await cache.add(url)
      resp = await cache.match(url)

      if (resp?.ok && parseInt(resp.headers.get("Content-Length"))) {
        return resp
      } else {
        return new Response("Not found!", { status: 404 })
      }
    }
  }
}

async function handlePut(url, body, type, modified = null) {
  url = url.split("?")[0]
  url = url.split("#")[0]
  if (url == root + "sync.json") {
    if (modified) return
    ws?.close()
  }
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

      case "txt":
        type = "text/plain"
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
    body = await body
    await cache.put(url, new Response(body, {
      headers: {
        "Content-Type": type,
        "Content-Length": body.length,
        "Last-Modified": (modified || new Date()).toUTCString()
      }
    }))
    queueUpload(url, modified)
    return new Response("File put!")
  }
}

async function handleDelete(url, modified) {
  url = url.split("?")[0]
  url = url.split("#")[0]
  if (url == root + "sync.json") {
    if (modified) return
    ws?.close()
  }
  let cache = await caches.open(location.pathname)

  if (url.slice(-1) == "/") {
    return new Response("Cannot delete directory!", { status: 400 })
  } else {
    await cache.put(url, new Response("", {
      //status: 404,
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": 0,
        "Last-Modified": (modified || new Date()).toUTCString()
      }
    }))
    queueUpload(url, modified)
    return new Response("File deleted!", { status: 200 })
  }
}


/* sync */

let ws, inaccessible = []
let user, room, account
let manifest = {}

async function generateManifest() {
  let cache = await caches.open(location.pathname)
  let keys = await cache.keys()
  for (let req of keys) {
    let entry = manifest[req.url] = manifest[req.url] || {}
    let resp = await cache.match(req.url)
    entry.modified = new Date(resp.headers.get("Last-Modified"))
    entry.size = parseInt(resp.headers.get("Content-Length"))
    console.log("entry", entry)
  }
  delete manifest[root + "sync.json"]
  manifest.isComplete = true
  connect()
}
generateManifest()

async function queueUpload(url, downloaded) {
  url = url.split("?")[0]
  url = url.split("#")[0]
  if (url == root + "sync.json") {
    connect()
    return delete manifest[root + "sync.json"]
  }
  let entry = manifest[url] = manifest[url] || {}
  clearTimeout(entry._pending)
  let cache = await caches.open(location.pathname)
  let resp = await cache.match(url)
  let body = await resp.bytes()
  entry.modified = new Date(resp.headers.get("Last-Modified"))
  entry.size = parseInt(resp.headers.get("Content-Length"))
  if (!downloaded) entry._pending = setTimeout(async () => {
    entry = JSON.parse(JSON.stringify(entry))
    entry.type = "obj"
    entry.to = "others"
    entry.id = url
    entry.mime = resp.headers.get("Content-Type")
    if (body.length > 32768) {
      for (let offset = 0; offset < body.length; offset += 32768) {
        entry.offset = offset
        entry.content = body.slice(offset, offset + 32768).toBase64()
        send(entry)
      }
    } else {
      entry.content = body.toBase64()
      send(entry)
    }
  }, 1024 + Math.random() * 4096)
}

async function connect() {
  if (ws && ws.readyState < 2) return
  account = null
  user = null
  room = null
  let cache = await caches.open(location.pathname)
  let resp = await cache.match(root + "sync.json")
  account = await resp.json()
  if (!account) return
  if (!account.name) return
  if (!account.password) return

  // Create WebSocket connection.
  ws = new WebSocket(account.url || "wss://hotater-eu.onrender.com/ws/chat")
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
        break

      case "topic":
        for (let roomId of inaccessible) {
          delete msg.rooms[roomId]
        }
        for (let roomId in msg.rooms) {
          if (msg.rooms[roomId].name == account.name) {
            inaccessible.push(roomId)
            return send({ type: "room", id: roomId, password: account.password })
          }
        }
        send({ type: "room", name: account.name, password: account.password })
        break

      case "room":
        room = msg
        if (inaccessible.includes(room.id)) inaccessible.splice(inaccessible.indexOf(room.id), 1)
        send({ type: "obj", to: "others", id: "manifest", manifest: manifest })
        break

      case "msg":
        console.log("msg", msg)
        break

      case "obj":
        clearTimeout(manifest[msg.id]?._pending)
        if (msg.id == "manifest") {
          for (let url in manifest) {
            msg.manifest[url] = msg.manifest[url] || { modified: 0 }
            msg.manifest[url].modified = new Date(msg.manifest[url].modified)
            if (msg.manifest[url].modified < (manifest[url]?.modified || 0)) {
              queueUpload(url)
            }
          }
        } else {
          msg.modified = new Date(msg.modified)
          if (msg.modified < (manifest[msg.id]?.modified || 0)) {
            queueUpload(msg.id)
          } else if (msg.modified > (manifest[msg.id]?.modified || 0)) {
            if (typeof msg.offset == "number") {
              let body = Uint8Array.fromBase64(msg.content)
              manifest[msg.id] = manifest[msg.id] || {}
              if (msg.offset == 0) manifest[msg.id].content = new Uint8Array(msg.size)
              manifest[msg.id].content.set(body, msg.offset)
              manifest[msg.id]._pending = setTimeout(() => {
                handlePut(msg.id, manifest[msg.id].content, msg.mime, msg.modified)
                delete manifest[msg.id].content
              }, 4096)
            } else if (msg.size) {
              handlePut(msg.id, Uint8Array.fromBase64(msg.content), msg.mime, msg.modified)
            } else {
              handleDelete(msg.id, msg.modified)
            }
          }
        }
        break

      case "feedme":
        fetch(msg.url)
        break

      default:
        console.error("I dunno what to do with", msg)
        break
    }
  })

  // Connection error
  ws.addEventListener("error", e => {
    console.error(e)
  })

  // Connection closed
  ws.addEventListener("close", e => {
    console.warn(e)
  })
}

function send(msg) {
  console.log("sending", msg, "...")
  ws?.send(JSON.stringify(msg))
  connect()
}

async function sendHashKey() {
  const encoder = new TextEncoder()
  const data = encoder.encode(user.id + "@" + location.protocol + "//" + location.host + "/duYJOCPvJ2oIvlzX0TgxGGVLTsjM2oDQ")
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data))
  let hex = ""
  for (let byte of hash) hex += byte.toString(16).padStart(2, "0")
  send({ type: "topic", key: hex })
}

async function sleep(msecs) {
  return new Promise((resolve, reject) => setTimeout(resolve, msecs))
}
