fetch('http://localhost:3000/api/variants/durov-cap')
  .then((r) => r.json())
  .then((d) => console.log(JSON.stringify(d, null, 2)));
