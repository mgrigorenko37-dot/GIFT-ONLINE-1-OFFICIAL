const https = require('https');

const fetchGraphQL = () => {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      query: `
        query {
          alphaNftItemSearch(query: "Durov", first: 10) {
            edges {
              node {
                name
                content {
                  ... on NftContentImage {
                    url
                  }
                }
              }
            }
          }
        }
      `
    });
    
    const req = https.request("https://api.getgems.io/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "curl/7.68.0", 
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    });
    req.write(data);
    req.end();
  });
};

fetchGraphQL().then(console.log);
