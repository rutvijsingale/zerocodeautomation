package support;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Resolves ${ENV_VAR} placeholders in step values to actual values from
 * the process environment at execution time. Mirrors the JS-side
 * utils/credentialResolver.js so both runtimes apply identical rules:
 *
 *   - Only ${UPPERCASE_WITH_UNDERSCORES} placeholders are resolved.
 *   - Empty / unset variables throw IllegalStateException naming the
 *     missing variable. We never silently fall back to typing the
 *     placeholder text.
 *   - Resolved values are NOT logged or surfaced; callers must use
 *     mask() before any println / report write.
 */
public final class CredentialsHelper {
  private static final Pattern PLACEHOLDER = Pattern.compile("\\\$\\{([A-Z][A-Z0-9_]*)\\}");

  private CredentialsHelper() {}

  public static String resolve(String value) {
    if (value == null) return null;
    Matcher m = PLACEHOLDER.matcher(value);
    if (!m.find()) return value;
    m.reset();
    StringBuffer out = new StringBuffer();
    while (m.find()) {
      String name = m.group(1);
      String env = System.getenv(name);
      if (env == null || env.isEmpty()) {
        throw new IllegalStateException(
          "Missing required environment variable " + name +
          ". Set it before running, e.g.  export " + name + "='...'");
      }
      m.appendReplacement(out, Matcher.quoteReplacement(env));
    }
    m.appendTail(out);
    return out.toString();
  }

  public static String mask(String value) {
    if (value == null || value.isEmpty()) return "";
    return "***";
  }
}
