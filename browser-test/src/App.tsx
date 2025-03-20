import { useEffect, useState } from "react";
import { Connection, Runtime } from "../../dist/src/index";

function App() {
  const [result, setResult] = useState<any>(null);
  useEffect(() => {
    const fetchResult = async () => {
      const connection = await Connection.connect({
        runtime: Runtime.TINY,
        // bearerToken: 'changeme',
        // apiKey: 'changeme',
      });
      const result = await connection.execute(
        "SHOW SCHEMAS IN wherobots_open_data",
      );
      console.log(result);
      setResult(result);
    };
    fetchResult();
  }, []);

  return (
    <>
      {result && (
        <div>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </>
  );
}

export default App;
