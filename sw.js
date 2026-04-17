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
      event.respondWith(handlePut(url, event.request.body, event.request.headers.contentType))
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
        if (!entries.includes(entry)) entries.push(entry)
      }
    }
    entries = entries.sort()
    let html = `<h1>${url}</h1><ul>`
    for (let entry of entries) {
      html += `<li><a href="${entry}">${entry}</a></li>`
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

  if (url.slice(-1) == "/") {
    return new Response("Cannot write to directory!", { status: 400 })
  } else {
    return cache.put(url, new Response(body, { headers: { "Content-Type": type } }))
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
