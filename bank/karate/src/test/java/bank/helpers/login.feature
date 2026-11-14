@ignore
Feature: login helper (call this, do not run it directly)
  Usage: * def auth = call read('classpath:bank/helpers/login.feature') { username: 'alice', password: 'Password123!' }
  Returns auth.token.

  Scenario:
    Given url baseUrl
    And path 'api', 'auth', 'login'
    And request { username: '#(username)', password: '#(password)' }
    When method post
    Then status 200
    * def token = response.token
