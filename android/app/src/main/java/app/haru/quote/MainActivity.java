package app.haru.quote;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;

import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends ComponentActivity {
    private static final int PAPER = Color.rgb(255, 249, 243);
    private static final int CARD = Color.rgb(248, 232, 218);
    private static final int INK = Color.rgb(55, 42, 36);
    private static final int ACCENT = Color.rgb(114, 69, 52);

    private Quotes store;
    private LinearLayout root;
    private LinearLayout toolbar;
    private WebView web;
    private String requestedId;
    private String requestedOrigin;
    private LocalDate readerDate;
    private boolean extrasVisible;
    private final OnBackPressedCallback readerBack = new OnBackPressedCallback(false) {
        @Override
        public void handleOnBackPressed() {
            if (web != null && web.canGoBack()) {
                web.goBack();
            } else {
                requestedId = null;
                requestedOrigin = null;
                open();
            }
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = new Quotes(this);
        readIntent(getIntent());
        if (state != null) {
            requestedId = state.getString("id");
            requestedOrigin = state.getString("origin");
            extrasVisible = state.getBoolean("extrasVisible");
        }
        getOnBackPressedDispatcher().addCallback(this, readerBack);
        open();
        DailyWidget.requestUpdate(this);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web == null && requestedId == null && readerDate != null && !readerDate.equals(Quotes.today())) {
            open();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        out.putString("id", requestedId);
        out.putString("origin", requestedOrigin);
        out.putBoolean("extrasVisible", extrasVisible);
        super.onSaveInstanceState(out);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readIntent(intent);
        open();
    }

    private void readIntent(Intent intent) {
        requestedId = null;
        requestedOrigin = null;
        Uri uri = intent.getData();
        if (!Quotes.OPEN_QUOTE.equals(intent.getAction()) || uri == null || !uri.isHierarchical()
                || !"haru".equals(uri.getScheme()) || !"quote".equals(uri.getAuthority())
                || uri.getPathSegments().size() != 1) return;
        String id = uri.getLastPathSegment();
        String origin = uri.getQueryParameter("origin");
        if (Quotes.validId(id) && origin != null && (origin.isEmpty() || origin.equals(Quotes.normalizeServer(origin)))) {
            requestedId = id;
            requestedOrigin = origin;
        }
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled") // The configured community site uses JavaScript.
    private void open() {
        String origin = store.server();
        if (origin.isEmpty() || (requestedId != null && !origin.equals(requestedOrigin))) {
            showReader(false);
            return;
        }

        buildFrame();
        web = new WebView(this);
        WebView browser = web;
        browser.setBackgroundColor(PAPER);
        browser.getSettings().setJavaScriptEnabled(true);
        browser.getSettings().setDomStorageEnabled(true);
        browser.getSettings().setAllowFileAccess(false);
        browser.getSettings().setAllowContentAccess(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false);
        browser.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri url = request.getUrl();
                if (sameOrigin(origin, url)) return false;
                if (request.hasGesture() && "https".equalsIgnoreCase(url.getScheme())) {
                    Intent external = new Intent(Intent.ACTION_VIEW, url);
                    try {
                        startActivity(external);
                    } catch (android.content.ActivityNotFoundException ignored) {
                        // This device has no browser to open the external link.
                    }
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                updateBackHandling();
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
                updateBackHandling();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) fallback(view, origin, request.getUrl());
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                    fallback(view, origin, request.getUrl());
                }
            }
        });
        root.addView(browser, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        Uri.Builder destination = Uri.parse(origin).buildUpon();
        if (requestedId != null) destination.appendPath("q").appendPath(requestedId);
        else destination.appendPath("");
        browser.loadUrl(destination.build().toString());
    }

    private static boolean sameOrigin(String origin, Uri candidate) {
        if (candidate.getHost() == null || candidate.getUserInfo() != null) return false;
        Uri reference = Uri.parse(origin);
        return reference.getScheme().equalsIgnoreCase(candidate.getScheme())
                && reference.getHost().equalsIgnoreCase(candidate.getHost())
                && effectivePort(reference) == effectivePort(candidate);
    }

    private static int effectivePort(Uri url) {
        return url.getPort() != -1 ? url.getPort() : ("https".equalsIgnoreCase(url.getScheme()) ? 443 : 80);
    }

    private void fallback(WebView view, String origin, Uri failed) {
        view.post(() -> {
            if (view != web) return;
            List<String> path = failed.getPathSegments();
            if (sameOrigin(origin, failed) && path.size() == 2 && "q".equals(path.get(0))
                    && Quotes.validId(path.get(1))) {
                requestedId = path.get(1);
                requestedOrigin = origin;
            }
            showReader(true);
        });
    }

    private void buildFrame() {
        destroyWeb();
        updateBackHandling();
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(PAPER);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            }
            return insets;
        });
        setContentView(root);

        toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(20), 0, dp(12), 0);
        root.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));
        TextView title = label(getString(R.string.app_name), 18, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        toolbar.addView(action("연결 설정", this::showSettings));
    }

    private void showReader(boolean failed) {
        buildFrame();
        ScrollView scroll = new ScrollView(this);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(18), dp(20), dp(28));
        scroll.addView(content);

        if (failed) {
            content.addView(label("서버에 연결할 수 없어요. 저장된 문장을 보여드려요.", 14, ACCENT));
            content.addView(action("다시 연결", this::open));
        }

        if (requestedId != null) {
            content.addView(action("오늘의 문장", () -> {
                requestedId = null;
                requestedOrigin = null;
                open();
            }));
            Quotes.Quote quote = store.byId(requestedOrigin, requestedId);
            if (quote == null) {
                content.addView(label("이 문장을 오프라인에서 찾을 수 없어요.", 16, INK));
            } else {
                content.addView(quoteCard(quote, true, true));
            }
            return;
        }

        LocalDate currentDate = Quotes.today();
        if (readerDate != null && !readerDate.equals(currentDate)) extrasVisible = false;
        readerDate = currentDate;
        TextView date = label(readerDate.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG)
                .withLocale(Locale.getDefault())), 14, ACCENT);
        content.addView(date);
        TextView heading = label("오늘의 문장", 30, INK);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
        content.addView(heading);
        List<Quotes.Quote> quotes = store.forDate(store.server(), readerDate);
        if (quotes.isEmpty()) {
            content.addView(label("오늘 읽을 문장이 아직 없어요.", 16, ACCENT));
            return;
        }
        content.addView(quoteCard(quotes.get(0), false, true));
        if (quotes.size() > 1) addMoreQuotes(content, quotes.subList(1, quotes.size()));
    }

    private void addMoreQuotes(LinearLayout content, List<Quotes.Quote> quotes) {
        LinearLayout extras = new LinearLayout(this);
        extras.setOrientation(LinearLayout.VERTICAL);
        for (Quotes.Quote quote : quotes) extras.addView(quoteCard(quote, false, false));

        Button disclosure = action(extrasVisible ? "추가 문장 접기" : "문장 더 읽기", null);
        disclosure.setOnClickListener(view -> {
            extrasVisible = !extrasVisible;
            extras.setVisibility(extrasVisible ? View.VISIBLE : View.GONE);
            disclosure.setText(extrasVisible ? "추가 문장 접기" : "문장 더 읽기");
        });
        extras.setVisibility(extrasVisible ? View.VISIBLE : View.GONE);
        content.addView(disclosure);
        content.addView(extras);
    }

    private View quoteCard(Quotes.Quote quote, boolean detail, boolean illustrated) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(18), dp(20), dp(12));
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(CARD);
        shape.setCornerRadius(dp(22));
        card.setBackground(shape);
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        layout.topMargin = dp(16);
        card.setLayoutParams(layout);
        if (illustrated) addIllustration(card);
        if (!quote.category().isEmpty()) card.addView(label(quote.category(), 13, ACCENT));
        TextView passage = label(quote.text(), 22, INK);
        passage.setTypeface(Typeface.SERIF);
        passage.setPadding(0, dp(10), 0, dp(8));
        passage.setLineSpacing(dp(5), 1);
        card.addView(passage);
        if (!quote.author().isEmpty()) card.addView(label(quote.author(), 14, ACCENT));

        if (!detail) {
            card.addView(action("문장 열기", () -> {
                requestedId = quote.id();
                requestedOrigin = store.server();
                showReader(!requestedOrigin.isEmpty());
            }));
        } else {
            LinearLayout actions = new LinearLayout(this);
            actions.addView(action("복사", () -> getSystemService(ClipboardManager.class)
                    .setPrimaryClip(ClipData.newPlainText(getString(R.string.app_name), shareText(quote)))));
            actions.addView(action("공유", () -> startActivity(Intent.createChooser(
                    new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, shareText(quote)), null))));
            card.addView(actions);
        }
        return card;
    }

    private void addIllustration(LinearLayout card) {
        try (InputStream input = getAssets().open("morning.webp")) {
            ImageView art = new ImageView(this);
            art.setImageBitmap(BitmapFactory.decodeStream(input));
            art.setScaleType(ImageView.ScaleType.CENTER_CROP);
            art.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            GradientDrawable corners = new GradientDrawable();
            corners.setColor(CARD);
            corners.setCornerRadius(dp(12));
            art.setBackground(corners);
            art.setClipToOutline(true);
            LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(92));
            layout.bottomMargin = dp(14);
            card.addView(art, layout);
        } catch (IOException ignored) {
            // The quote and its actions are available without the illustration.
        }
    }

    private static String shareText(Quotes.Quote quote) {
        return quote.author().isEmpty() ? quote.text() : quote.text() + "\n— " + quote.author();
    }

    private void showSettings() {
        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("https://example.com");
        address.setText(store.server());
        LinearLayout frame = new LinearLayout(this);
        frame.setPadding(dp(20), 0, dp(20), 0);
        frame.addView(address, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("서버 주소")
                .setMessage("주소를 비워 두면 기기에 포함된 문장을 읽을 수 있어요.")
                .setView(frame)
                .setNegativeButton("취소", null)
                .setPositiveButton("저장", null)
                .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String input = address.getText().toString().trim();
            String server = input.isEmpty() ? "" : Quotes.normalizeServer(input);
            if (server == null) {
                address.setError(BuildConfig.DEBUG ? "HTTPS 주소 또는 테스트용 로컬 HTTP 주소를 입력하세요."
                        : "HTTPS 서버 주소를 입력하세요.");
                return;
            }
            store.setServer(server);
            requestedId = null;
            requestedOrigin = null;
            dialog.dismiss();
            DailyWidget.requestUpdate(this);
            open();
        }));
        dialog.show();
    }

    private TextView label(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private Button action(String value, Runnable callback) {
        Button button = new Button(this, null, android.R.attr.borderlessButtonStyle);
        button.setMinHeight(dp(48));
        button.setMinWidth(dp(48));
        button.setText(value);
        button.setTextColor(ACCENT);
        button.setTextSize(14);
        if (callback != null) button.setOnClickListener(view -> callback.run());
        return button;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void updateBackHandling() {
        readerBack.setEnabled(requestedId != null || (web != null && web.canGoBack()));
    }

    @Override
    protected void onDestroy() {
        destroyWeb();
        super.onDestroy();
    }

    private void destroyWeb() {
        if (web == null) return;
        if (web.getParent() instanceof ViewGroup parent) parent.removeView(web);
        web.destroy();
        web = null;
    }
}
