package app.haru.quote;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class DailyWidget extends AppWidgetProvider {
    private static final String REFRESH = "app.haru.quote.REFRESH_WIDGET";
    private static final ExecutorService UPDATES = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (AppWidgetManager.ACTION_APPWIDGET_UPDATE.equals(action) || REFRESH.equals(action)
                || Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            update(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        // onReceive starts the shared refresh, including alarm scheduling.
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, android.os.Bundle options) {
        update(context);
    }

    static void requestUpdate(Context context) {
        context.sendBroadcast(new Intent(context, DailyWidget.class).setAction(REFRESH));
    }

    @Override
    public void onDisabled(Context context) {
        context.getSystemService(AlarmManager.class).cancel(alarm(context));
    }

    private void update(Context context) {
        Context app = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(app);
        ComponentName provider = new ComponentName(app, DailyWidget.class);
        if (manager.getAppWidgetIds(provider).length == 0) return;

        Quotes store = new Quotes(app);
        LocalDate date = Quotes.today();
        String origin = store.server();
        draw(app, manager, provider, origin, store.forDate(origin, date));
        long nextMidnight = date.plusDays(1).atStartOfDay(Quotes.SEOUL).toInstant().toEpochMilli();
        app.getSystemService(AlarmManager.class).setAndAllowWhileIdle(
                AlarmManager.RTC, nextMidnight, alarm(app));

        if (origin.isEmpty()) return;
        PendingResult result = goAsync();
        UPDATES.execute(() -> {
            try {
                if (store.refresh(origin, date) && origin.equals(store.server()) && date.equals(Quotes.today())) {
                    draw(app, manager, provider, origin, store.forDate(origin, date));
                }
            } finally {
                result.finish();
            }
        });
    }

    private static PendingIntent alarm(Context context) {
        Intent refresh = new Intent(context, DailyWidget.class).setAction(REFRESH);
        return PendingIntent.getBroadcast(context, 0, refresh, PendingIntent.FLAG_IMMUTABLE);
    }

    private static void draw(Context context, AppWidgetManager manager, ComponentName provider,
                             String origin, List<Quotes.Quote> quotes) {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.daily_widget);
        Intent click = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (!quotes.isEmpty()) {
            Quotes.Quote quote = quotes.get(0);
            view.setTextViewText(R.id.widget_quote, quote.text());
            view.setTextViewText(R.id.widget_author, quote.author());
            click.setAction(Quotes.OPEN_QUOTE);
            click.setData(new Uri.Builder().scheme("haru").authority("quote").appendPath(quote.id())
                    .appendQueryParameter("origin", origin).build());
        } else {
            view.setTextViewText(R.id.widget_quote, "오늘 읽을 문장이 아직 없어요.");
            view.setTextViewText(R.id.widget_author, "");
        }
        PendingIntent open = PendingIntent.getActivity(context, 0, click, PendingIntent.FLAG_IMMUTABLE);
        view.setOnClickPendingIntent(R.id.widget_card, open);
        manager.updateAppWidget(provider, view);
    }
}
