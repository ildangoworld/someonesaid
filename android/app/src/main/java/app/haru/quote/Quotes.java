package app.haru.quote;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

final class Quotes {
    static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    static final String OPEN_QUOTE = "app.haru.quote.OPEN_QUOTE";
    private static final int MAX_JSON_SIZE = 128 * 1024;

    record Quote(String id, String text, String author, String category) {
        static Quote fromJson(JSONObject json) throws JSONException {
            String id = json.getString("id");
            String text = json.getString("text");
            if (!validId(id) || text.trim().isEmpty()) throw new JSONException("Invalid quote");
            return new Quote(id, text, json.optString("author", ""), json.optString("category", ""));
        }
    }

    private final Context context;
    private final SharedPreferences prefs;

    Quotes(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = context.getSharedPreferences("haru", Context.MODE_PRIVATE);
    }

    static boolean validId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,128}");
    }

    static LocalDate today() {
        return LocalDate.now(SEOUL);
    }

    static String normalizeServer(String input) {
        try {
            URI uri = URI.create(input.trim());
            String host = uri.getHost();
            String scheme = uri.getScheme();
            boolean local = "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host)
                    || "10.0.2.2".equals(host);
            boolean supportedScheme = "https".equalsIgnoreCase(scheme)
                    || (BuildConfig.DEBUG && local && "http".equalsIgnoreCase(scheme));
            if (host == null || !supportedScheme || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || uri.getPort() > 65535 || uri.getPort() == 0
                    || (!uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath()))) return null;
            return new URI(scheme.toLowerCase(java.util.Locale.ROOT), null,
                    host.toLowerCase(java.util.Locale.ROOT), uri.getPort(), null, null, null)
                    .toASCIIString();
        } catch (IllegalArgumentException | java.net.URISyntaxException exception) {
            return null;
        }
    }

    String server() {
        return prefs.getString("server", BuildConfig.DEFAULT_SERVER);
    }

    void setServer(String origin) {
        prefs.edit().putString("server", origin).apply();
    }

    List<Quote> forDate(String origin, LocalDate date) {
        if (!origin.isEmpty() && (origin + "|" + date).equals(prefs.getString("cacheKey", ""))) {
            try {
                return parse(new JSONArray(prefs.getString("cacheQuotes", "[]")));
            } catch (JSONException ignored) {
                // A cache can always be rebuilt from the service or bundled quotes.
            }
        }
        List<Quote> seeds = seeds();
        if (seeds.isEmpty()) return seeds;
        int first = (int) Math.floorMod(date.toEpochDay(), (long) seeds.size());
        List<Quote> today = new ArrayList<>();
        for (int offset = 0; offset < Math.min(3, seeds.size()); offset++) {
            today.add(seeds.get((first + offset) % seeds.size()));
        }
        return today;
    }

    Quote byId(String origin, String id) {
        if (!validId(id)) return null;
        if (!origin.isEmpty()) {
            String stored = prefs.getString("history|" + origin + "|" + id, null);
            if (stored != null) {
                try {
                    return Quote.fromJson(new JSONObject(stored));
                } catch (JSONException ignored) {
                    // Fall back to the bundled edition of the same quote, if present.
                }
            }
        }
        for (Quote quote : seeds()) if (quote.id().equals(id)) return quote;
        return null;
    }

    boolean refresh(String origin, LocalDate date) {
        if (origin.isEmpty()) return false;
        HttpURLConnection connection = null;
        try {
            Uri url = Uri.parse(origin).buildUpon().appendPath("api").appendPath("daily")
                    .appendQueryParameter("date", date.toString()).build();
            connection = (HttpURLConnection) URI.create(url.toString()).toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setConnectTimeout(2200);
            connection.setReadTimeout(2200);
            if (connection.getResponseCode() != 200) return false;
            JSONArray daily;
            try (InputStream stream = connection.getInputStream()) {
                daily = new JSONObject(read(stream)).getJSONArray("quotes");
            }
            parse(daily);
            if (!origin.equals(server()) || !date.equals(today())) return false;
            SharedPreferences.Editor changes = prefs.edit().putString("cacheKey", origin + "|" + date)
                    .putString("cacheQuotes", daily.toString());
            for (int i = 0; i < daily.length(); i++) {
                JSONObject quote = daily.getJSONObject(i);
                changes.putString("history|" + origin + "|" + quote.getString("id"), quote.toString());
            }
            changes.apply();
            return true;
        } catch (IOException | JSONException | IllegalArgumentException exception) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private List<Quote> seeds() {
        try (InputStream input = context.getAssets().open("seeds.json")) {
            String json = read(input).trim();
            return parse(json.startsWith("[") ? new JSONArray(json) : new JSONObject(json).getJSONArray("quotes"));
        } catch (IOException | JSONException exception) {
            return java.util.Collections.emptyList();
        }
    }

    private static List<Quote> parse(JSONArray array) throws JSONException {
        List<Quote> result = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) result.add(Quote.fromJson(array.getJSONObject(i)));
        return result;
    }

    private static String read(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > MAX_JSON_SIZE) throw new IOException("Quote response too large");
            output.write(buffer, 0, count);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }
}
