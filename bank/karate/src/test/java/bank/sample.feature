@regression
Feature: sample (generated from sample.har)
  Review the assertions before committing: shapes are generated, exact values are not.

  Background:
    * url baseUrl

  @generated
  Scenario: sample flow
    # start from known seed data
    Given path 'api', 'test', 'reset'
    When method post
    Then status 204

    # 1. POST /api/auth/login -> 200
    Given path 'api', 'auth', 'login'
    And request {"username":"alice","password":"Password123!"}
    When method post
    Then status 200
    And match response == {'token':'#string','tokenType':'#string','expiresIn':'#number','user':{'username':'#string','fullName':'#string'}}
    * def token = response.token

    # 2. GET /api/me -> 200
    Given path 'api', 'me'
    And header Authorization = 'Bearer ' + token
    When method get
    Then status 200
    And match response == {'username':'#string','fullName':'#string'}

    # 3. GET /api/accounts -> 200
    Given path 'api', 'accounts'
    And header Authorization = 'Bearer ' + token
    When method get
    Then status 200
    And match response == {'accounts':'#array'}
    And match each response.accounts == {'id':'#string','type':'#string','currency':'#string','balance':'#number'}

    # 4. GET /api/accounts/1001/transactions?limit=10 -> 200
    Given path 'api', 'accounts', '1001', 'transactions'
    And param limit = '10'
    And header Authorization = 'Bearer ' + token
    When method get
    Then status 200
    And match response == {'accountId':'#string','total':'#number','transactions':'#array'}
    And match each response.transactions == {'id':'#string','type':'#string','amount':'#number','description':'#string','counterparty':'#present','balanceAfter':'#number','date':'#string'}

    # 5. POST /api/transfers -> 201
    Given path 'api', 'transfers'
    And header Authorization = 'Bearer ' + token
    And request {"fromAccountId":"1001","toAccountId":"1002","amount":25,"description":"Rent"}
    When method post
    Then status 201
    And match response == {'transferId':'#string','fromAccountId':'#string','toAccountId':'#string','amount':'#number','status':'#string','fromBalance':'#number'}

    # 6. POST /api/transfers -> 400
    Given path 'api', 'transfers'
    And header Authorization = 'Bearer ' + token
    And request {"fromAccountId":"1001","toAccountId":"1002","amount":-1}
    When method post
    Then status 400
    And match response == {'error':{'code':'#string','message':'#string'}}
    And match response.error.code == 'VALIDATION_ERROR'

    # 7. POST /api/auth/logout -> 204
    Given path 'api', 'auth', 'logout'
    And header Authorization = 'Bearer ' + token
    When method post
    Then status 204
