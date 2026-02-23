// Store client configurations in a map
// Structure: { clientId: { sshClientID: string, host: string  } }
let clientMap = {};
var mainClient;

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  let clientId = event.clientId;
  
  console.log("fetch intercepted: " + url + ", clientId: " + clientId + ' replaces client ' + event.replacesClientId + ' resulting client id:' + event.resultingClientId);
  
  if (!clientId && event.resultingClientId) {
    clientId = event.resultingClientId;
  }

  if (!clientId) {
    return;
  }

  if (url.pathname.includes('/favicon.ico')) {
    return;
  }

  if(url.pathname.includes('/registerportforward')) {
    console.log('received registerportforward request from client ' + clientId);
    event.respondWith( new Response(event.clientId, { status: 200 }));
    mainClient = clientId;
    return 
  }

  if(url.pathname.includes('/portforward')) {
    let pathArray = url.pathname.split('/');
    let sshClientID = null;
    let targetHost = null;
    // portforward path should contain id of the window running the ssh client and the host to target
    // eg. /portforward/11d62b68-cefa-4014-9dbb-433daba89268/localhost:8080
    for (i = 0; i < pathArray.length-2; i++) {
      if(pathArray[i] == "portforward") {
        sshClientID = pathArray[i+1];
        targetHost = pathArray.slice(i+2).join('/');
        break;
      }
    }
    if (sshClientID && targetHost) {
      clientMap[clientId] = { sshClientID: sshClientID, host: targetHost };
      console.log('sw: new tunnel client registered, id=' + clientId + ", ssh client id: " + sshClientID + ", target host: " + targetHost);
    }
  }

  let clientConfig = null;

  // Check if this client ID is already known
  if (clientMap[clientId]) {
    // Client already registered, serve according to its stored classification
    clientConfig = clientMap[clientId];
    console.log('sw: found client with id: ' + clientId) ;
    
    if (event.resultingClientId != null && event.resultingClientId != "") {
      console.log('sw: client with resulting client id:' + event.resultingClientId +' added to the clients') ;
      clientMap[event.resultingClientId] = clientConfig;
    } 
  }else if (clientMap[event.replacesClientId]){
    clientConfig = clientMap[vent.replacesClientId];
    console.log('sw: client ' + clientId + ' replaces client ' + event.replacesClientId);
    clientMap[event.replacesClientId] = clientConfig;
  } 
  if (clientConfig) {
      console.log('sw: tunneling request');
      event.respondWith(handlePortForwardedRequest(event, clientConfig));
  }
});

// Ensure the service worker takes control of clients immediately after install
self.addEventListener('install', event => {
  console.log('sw: install');
  // Activate worker immediately
  //  event.waitUntil(self.skipWaiting()); 
});

// Claim clients on activate so the SW controls open pages without a reload
self.addEventListener('activate', event => {
  console.log('sw: activate');
  event.waitUntil(self.clients.claim());
});

// Store pending responses for FETCH_INTERCEPT_RESPONSE messages
let pendingResponses = {};

// Receive messages from clients to register main clients or handle responses
self.addEventListener('message', event => {
    if (event.data?.type === 'FETCH_INTERCEPT_RESPONSE') {
    const id = event.data.id;
    if (pendingResponses[id]) {
      pendingResponses[id].resolve(event.data.response);
      delete pendingResponses[id];
    }
  }
});

async function handlePortForwardedRequest(event, clientConfig) {
  const reqId = Math.random().toString(36).slice(2);

  const reqData = {
    id: reqId,
    host: clientConfig.host,
    sshClientID: clientConfig.sshClientID,
    method: event.request.method,
    url: event.request.url,
    headers: Object.fromEntries(event.request.headers.entries()),
    body: (event.request.method !== 'GET' && event.request.method !== 'HEAD')
      ? await event.request.text()
      : null,
  };

  const client = await self.clients.get(clientConfig.sshClientID);
  console.log('sw: sending FETCH_INTERCEPT to ssh client: ' + clientConfig.sshClientID + 'with id=' + reqId);
  client.postMessage({ type: 'FETCH_INTERCEPT', data: reqData });

  const responseData = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log('sw: timeout waiting for FETCH_INTERCEPT_RESPONSE for id=' + reqId);
      delete pendingResponses[reqId];
      reject(new Error('Client response timeout'));
    }, 30000); // 30 second timeout

    pendingResponses[reqId] = { resolve, reject };
  }).catch(err => {
    console.error('sw: error waiting for response:', err);
    throw err;
  });

  return new Response(responseData.body, {
    status: responseData.status,
    headers: responseData.headers,
  });
}
