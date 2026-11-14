@ignore
Feature: failed login helper (call this, do not run it directly)

  Scenario:
    Given url baseUrl
    And path 'api', 'auth', 'login'
    And request { username: '#(username)', password: 'wrong-password' }
    When method post
    Then status 401
