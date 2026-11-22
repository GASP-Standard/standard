"""Parse expressions with the upstream Ossie expression grammar.

Usage: ossie-grammar.py <OssieExpression.g4> <cache dir>, with a JSON list of
expressions on stdin. Prints a JSON list of the same length: the syntax errors
for each expression, empty when it parses.

The parser is generated on each run with the ANTLR tool, as the upstream tests
do (core-spec/grammar/tests/conftest.py in apache/ossie, Apache License 2.0,
which this follows): the same ANTLR version, the same jar from Maven Central,
checked against the same SHA-256. The jar is kept in the cache directory and
nothing generated is kept. A download Maven Central refuses for now (429, a
5xx or no connection) is tried again after a wait. Needs Java 11 or later on
PATH and the antlr4-python3-runtime package of the same version:

    uv run --no-project --with antlr4-python3-runtime==4.13.2 python test/ossie-grammar.py ...

Run by test/ossie-grammar.test.ts.
"""

import hashlib
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ANTLR_VERSION = "4.13.2"
ANTLR_SHA256 = "eae2dfa119a64327444672aff63e9ec35a20180dc5b8090b7a6ab85125df4d76"
ANTLR_URL = (
    "https://repo1.maven.org/maven2/org/antlr/antlr4/"
    f"{ANTLR_VERSION}/antlr4-{ANTLR_VERSION}-complete.jar"
)
# Seconds to wait before the second, third and fourth attempts at the download.
RETRY_WAITS = (2, 10, 30)


def download(url, waits=RETRY_WAITS, timeout=60):
    """The bytes at a URL. A 429, a 5xx or a failed connection is tried again
    after each wait in turn; any other answer is raised at once."""
    for wait in (*waits, None):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as e:
            if wait is None or (e.code != 429 and e.code < 500):
                raise
            reason = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError) as e:
            if wait is None:
                raise
            reason = str(e)
        print(f"{url}: {reason}, trying again in {wait}s", file=sys.stderr)
        time.sleep(wait)


def antlr_jar(cache):
    """The verified ANTLR jar, downloaded into the cache directory on first use."""
    jar = cache / f"antlr4-{ANTLR_VERSION}-complete.jar"
    if not jar.exists():
        cache.mkdir(parents=True, exist_ok=True)
        part = jar.with_suffix(".part")
        part.write_bytes(download(ANTLR_URL))
        part.replace(jar)
    if hashlib.sha256(jar.read_bytes()).hexdigest() != ANTLR_SHA256:
        jar.unlink()
        sys.exit(f"{jar.name} does not match the pinned SHA-256; removed, rerun to download")
    return jar


def main():
    grammar, cache = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    expressions = json.load(sys.stdin)
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(
            ["java", "-jar", str(antlr_jar(cache)), "-Dlanguage=Python3", "-Werror", "-o", out, str(grammar)],
            check=True,
            stdout=sys.stderr,
        )
        sys.path.insert(0, out)
        from antlr4 import CommonTokenStream, InputStream
        from antlr4.error.ErrorListener import ErrorListener
        from OssieExpressionLexer import OssieExpressionLexer
        from OssieExpressionParser import OssieExpressionParser

        class Collect(ErrorListener):
            def __init__(self):
                self.errors = []

            def syntaxError(self, recognizer, symbol, line, column, msg, e):
                self.errors.append(f"{line}:{column} {msg}")

        def errors_in(text):
            collect = Collect()
            lexer = OssieExpressionLexer(InputStream(text))
            lexer.removeErrorListeners()
            lexer.addErrorListener(collect)
            parser = OssieExpressionParser(CommonTokenStream(lexer))
            parser.removeErrorListeners()
            parser.addErrorListener(collect)
            parser.expression()
            return collect.errors

        json.dump([errors_in(text) for text in expressions], sys.stdout)


if __name__ == "__main__":
    main()
