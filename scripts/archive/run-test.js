const { Address } = require('@ton/core');
try {
  console.log(Address.parse('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N').toRawString());
} catch (e) {
  console.error(e);
}
