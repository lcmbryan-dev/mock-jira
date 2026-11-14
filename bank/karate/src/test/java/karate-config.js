function fn() {
  var env = karate.env || 'dev';
  var config = {
    env: env,
    // override with: mvn test -Dbase.url=http://host:port
    baseUrl: karate.properties['base.url'] || 'http://localhost:3000'
  };
  return config;
}
