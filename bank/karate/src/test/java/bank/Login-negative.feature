@regression @negative
Feature: Login flow - negative tests
  Covers the endpoints in Login.feature: login, /me, /accounts, /accounts/:id/transactions.

  Background:
    * url baseUrl
    # every scenario starts from known seed data
    Given path 'api', 'test', 'reset'
    When method post
    Then status 204

  # ---- POST /api/auth/login ----

  Scenario: wrong password is rejected with 401
    Given path 'api', 'auth', 'login'
    And request { username: 'alice', password: 'not-the-password' }
    When method post
    Then status 401
    And match response == { error: { code: 'INVALID_CREDENTIALS', message: '#string' } }
    And match response.token == '#notpresent'

  Scenario: unknown user gets the same 401 as a wrong password (no user enumeration)
    Given path 'api', 'auth', 'login'
    And request { username: 'alice', password: 'not-the-password' }
    When method post
    Then status 401
    * def wrongPassword = response

    Given path 'api', 'auth', 'login'
    And request { username: 'nobody', password: 'not-the-password' }
    When method post
    Then status 401
    And match response == wrongPassword

  Scenario Outline: missing or invalid credential fields are rejected with 400 (<case>)
    Given path 'api', 'auth', 'login'
    And request <body>
    When method post
    Then status 400
    And match response == { error: { code: 'VALIDATION_ERROR', message: '#string' } }

    Examples:
      | case                | body                                   |
      | empty body          | {}                                     |
      | missing password    | { username: 'alice' }                  |
      | missing username    | { password: 'Password123!' }           |
      | empty strings       | { username: '', password: '' }         |
      | password not string | { username: 'alice', password: 12345 } |
      | username is null    | { username: null, password: 'x' }      |

  Scenario: malformed JSON body is rejected with 400
    Given path 'api', 'auth', 'login'
    And header Content-Type = 'application/json'
    And request '{"username": "alice", '
    When method post
    Then status 400
    And match response.error.code == 'BAD_REQUEST'

  Scenario: pre-locked account is rejected with 423 even with the right password
    Given path 'api', 'auth', 'login'
    And request { username: 'locked', password: 'Password123!' }
    When method post
    Then status 423
    And match response.error.code == 'ACCOUNT_LOCKED'

  Scenario: five failed attempts lock the account, then the correct password is rejected
    * karate.repeat(5, function(i){ return karate.call('classpath:bank/helpers/bad-login.feature', { username: 'bob' }) })
    Given path 'api', 'auth', 'login'
    And request { username: 'bob', password: 'Password123!' }
    When method post
    Then status 423
    And match response.error.code == 'ACCOUNT_LOCKED'

  Scenario: login only accepts POST (GET returns 405)
    Given path 'api', 'auth', 'login'
    When method get
    Then status 405
    And match response.error.code == 'METHOD_NOT_ALLOWED'

  # ---- protected GET endpoints ----

  Scenario Outline: <endpoint> without a token is rejected with 401
    Given path <path>
    When method get
    Then status 401
    And match response == { error: { code: 'UNAUTHORIZED', message: '#string' } }

    Examples:
      | endpoint      | path                                      |
      | /me           | 'api', 'me'                               |
      | /accounts     | 'api', 'accounts'                         |
      | /transactions | 'api', 'accounts', '1001', 'transactions' |

  Scenario Outline: <case> is rejected with 401
    Given path 'api', 'me'
    And header Authorization = <header>
    When method get
    Then status 401
    And match response.error.code == 'UNAUTHORIZED'

    Examples:
      | case               | header                           |
      | bogus bearer token | 'Bearer 0123456789abcdef'        |
      | wrong auth scheme  | 'Basic YWxpY2U6UGFzc3dvcmQxMjMh' |
      | empty bearer token | 'Bearer '                        |

  Scenario: another user's account cannot be read (403) and an unknown one is 404
    * def auth = call read('classpath:bank/helpers/login.feature') { username: 'alice', password: 'Password123!' }
    * configure headers = { Authorization: '#("Bearer " + auth.token)' }

    Given path 'api', 'accounts', '2001'
    When method get
    Then status 403
    And match response.error.code == 'FORBIDDEN'

    Given path 'api', 'accounts', '2001', 'transactions'
    When method get
    Then status 403
    And match response.error.code == 'FORBIDDEN'

    Given path 'api', 'accounts', '9999', 'transactions'
    When method get
    Then status 404
    And match response.error.code == 'ACCOUNT_NOT_FOUND'

  Scenario: a token is useless after logout
    * def auth = call read('classpath:bank/helpers/login.feature') { username: 'alice', password: 'Password123!' }
    * configure headers = { Authorization: '#("Bearer " + auth.token)' }

    Given path 'api', 'auth', 'logout'
    When method post
    Then status 204

    Given path 'api', 'accounts'
    When method get
    Then status 401
