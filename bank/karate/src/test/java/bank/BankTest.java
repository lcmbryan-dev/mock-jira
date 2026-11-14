package bank;

import com.intuit.karate.Results;
import com.intuit.karate.Runner;
import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class BankTest {

    // Runs every .feature under classpath:bank against a running server (npm start).
    // Features share one server and reset its data, so keep this sequential.
    @Test
    void testAll() {
        Results results = Runner.path("classpath:bank").tags("~@ignore").parallel(1);
        assertEquals(0, results.getFailCount(), results.getErrorMessages());
    }
}
