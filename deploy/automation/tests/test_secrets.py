import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview_secrets import ensure_secret


class Sealing(unittest.TestCase):
    def test_real_sealing_recovery_namespace_binding_and_stability(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            certificate, key = root / "cert.crt", root / "private.key"
            subprocess.run(["openssl", "req", "-x509", "-nodes", "-newkey", "rsa:2048",
                            "-keyout", str(key), "-out", str(certificate), "-days", "1",
                            "-subj", "/CN=preview-test"], check=True, capture_output=True)
            password = "integration-test-password-never-for-real-use"
            with patch.dict(os.environ, {"PREVIEW_DEX_PASSWORD": password}):
                ensure_secret(root, "123", certificate)
            target = root / "sealed-secret.json"
            original = target.read_bytes()
            self.assertNotIn(password.encode(), original)
            with patch.dict(os.environ, {"PREVIEW_DEX_PASSWORD": ""}):
                ensure_secret(root, "123", certificate)
            self.assertEqual(target.read_bytes(), original, "Image updates must keep signing/client secrets")
            command = ["kubeseal", "--recovery-unseal", "--recovery-private-key", str(key)]
            recovered = subprocess.check_output(command, input=original)
            data = {k: base64.b64decode(v).decode() for k, v in json.loads(recovered)["data"].items()}
            dex = json.loads(data["dex-config"])
            self.assertEqual(dex["issuer"], "https://pr-123.skjera.capraconsulting.no/dex")
            self.assertEqual(dex["staticClients"][0]["secret"], data["oidc-client-secret"])
            self.assertTrue(dex["staticPasswords"][0]["hash"].startswith(("$2y$10$", "$2a$10$", "$2b$10$")))
            self.assertNotIn(password, data["dex-config"])
            sealed = json.loads(original)
            sealed["metadata"]["namespace"] = "skjera-pr-124"
            sealed["spec"]["template"]["metadata"]["namespace"] = "skjera-pr-124"
            result = subprocess.run(command, input=json.dumps(sealed).encode(), capture_output=True)
            self.assertNotEqual(result.returncode, 0, "Ciphertext must not work in another PR namespace")


if __name__ == "__main__":
    unittest.main()
