@regression @negative
Feature: Transfer and logout flow - negative tests
  Covers the endpoints in sample.feature: login, /me, /accounts, transactions, /transfers, logout.

  Background:
    * url baseUrl
    # every scenario starts from known seed data
    Given path 'api', 'test', 'reset'
    When method post
    Then status 204
    * def auth = call read('classpath:bank/helpers/login.feature') { username: 'alice', password: 'Password123!' }
    * configure headers = { Authorization: '#("Bearer " + auth.token)' }

  # ---- POST /api/transfers: validation ----

  Scenario Outline: invalid transfer is rejected with 400 (<case>)
    Given path 'api', 'transfers'
    And request <body>
    When method post
    Then status 400
    And match response == { error: { code: 'VALIDATION_ERROR', message: '#string' } }

    Examples:
      | case                  | body                                                         |
      | negative amount       | { fromAccountId: '1001', toAccountId: '1002', amount: -1 }   |
      | zero amount           | { fromAccountId: '1001', toAccountId: '1002', amount: 0 }    |
      | three decimal places  | { fromAccountId: '1001', toAccountId: '1002', amount: 1.005 }|
      | amount as string      | { fromAccountId: '1001', toAccountId: '1002', amount: '10' } |
      | missing amount        | { fromAccountId: '1001', toAccountId: '1002' }               |
      | missing destination   | { fromAccountId: '1001', amount: 10 }                        |
      | account ids as number | { fromAccountId: 1001, toAccountId: 1002, amount: 10 }       |
      | same account          | { fromAccountId: '1001', toAccountId: '1001', amount: 10 }   |

  # ---- POST /api/transfers: business rules ----

  Scenario: insufficient funds is rejected with 422 and no balances change
    Given path 'api', 'transfers'
    And request { fromAccountId: '1001', toAccountId: '1002', amount: 999999 }
    When method post
    Then status 422
    And match response.error.code == 'INSUFFICIENT_FUNDS'

    Given path 'api', 'accounts', '1001'
    When method get
    Then status 200
    And match response.balance == 2500

    Given path 'api', 'accounts', '1002'
    When method get
    Then status 200
    And match response.balance == 10000

  Scenario: a failed transfer is not recorded in the transaction history
    Given path 'api', 'accounts', '1001', 'transactions'
    When method get
    Then status 200
    * def before = response.total

    Given path 'api', 'transfers'
    And request { fromAccountId: '1001', toAccountId: '1002', amount: 999999 }
    When method post
    Then status 422

    Given path 'api', 'accounts', '1001', 'transactions'
    When method get
    Then status 200
    And match response.total == before

  Scenario: cannot transfer out of someone else's account (403) and balance is untouched
    Given path 'api', 'transfers'
    And request { fromAccountId: '2001', toAccountId: '1001', amount: 5 }
    When method post
    Then status 403
    And match response.error.code == 'FORBIDDEN'

    * def bob = call read('classpath:bank/helpers/login.feature') { username: 'bob', password: 'Password123!' }
    * configure headers = { Authorization: '#("Bearer " + bob.token)' }
    Given path 'api', 'accounts', '2001'
    When method get
    Then status 200
    And match response.balance == 800

  Scenario: transfer to a nonexistent account is rejected with 404 and no money leaves
    Given path 'api', 'transfers'
    And request { fromAccountId: '1001', toAccountId: '9999', amount: 5 }
    When method post
    Then status 404
    And match response.error.code == 'ACCOUNT_NOT_FOUND'

    Given path 'api', 'accounts', '1001'
    When method get
    Then status 200
    And match response.balance == 2500

  # ---- authentication on the same endpoints ----

  Scenario: transfer without a token is rejected with 401 and nothing moves
    * configure headers = {}
    Given path 'api', 'transfers'
    And request { fromAccountId: '1001', toAccountId: '1002', amount: 5 }
    When method post
    Then status 401
    And match response.error.code == 'UNAUTHORIZED'

    Given path 'api', 'accounts', '1001'
    And header Authorization = 'Bearer ' + auth.token
    When method get
    Then status 200
    And match response.balance == 2500

  Scenario: logout without a token is rejected with 401
    * configure headers = {}
    Given path 'api', 'auth', 'logout'
    When method post
    Then status 401

  Scenario: a logged-out token cannot make a transfer
    Given path 'api', 'auth', 'logout'
    When method post
    Then status 204

    Given path 'api', 'transfers'
    And request { fromAccountId: '1001', toAccountId: '1002', amount: 5 }
    When method post
    Then status 401
    And match response.error.code == 'UNAUTHORIZED'

  Scenario: transaction list rejects an account the caller does not own
    Given path 'api', 'accounts', '2001', 'transactions'
    When method get
    Then status 403
    And match response.error.code == 'FORBIDDEN'
