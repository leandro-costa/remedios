package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.leandrocosta.remedios.push.FakePushServer;
import io.github.leandrocosta.remedios.push.FakePushServer.Browser;
import io.github.leandrocosta.remedios.push.OutboxPublisher;
import io.github.leandrocosta.remedios.push.PushSubscription;
import io.github.leandrocosta.remedios.push.ReminderService;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Lembretes e avisos por Web Push, verificados num serviço de push falso. */
@QuarkusTest
class NotificationTest {

    static FakePushServer server;

    @Inject
    ReminderService reminders;

    @Inject
    OutboxPublisher outbox;

    Dosing d;
    Browser anaPhone;
    Browser brunoPhone;
    Instant at;
    String dose;

    @BeforeAll
    static void start() throws Exception {
        server = new FakePushServer();
    }

    @AfterAll
    static void stop() {
        server.close();
    }

    @BeforeEach
    void setUp() throws Exception {
        d = new Dosing();
        anaPhone = subscribe(d.ana, d.anaDevice);
        brunoPhone = subscribe(d.bruno, d.brunoDevice);
        at = d.now.plus(2, ChronoUnit.HOURS);
        String treatment = d.createTreatment(Dosing.dailyAt(at));
        d.activate(treatment, 1, d.now);
        dose = d.occurrenceAt(at);
        outbox.publish(Instant.now().plus(1, ChronoUnit.DAYS)); // descarta avisos do cadastro
        anaPhone.take();
        brunoPhone.take();
    }

    @Test
    void pushIsConfigured() {
        d.ana.req().get("/api/push/config").then().statusCode(200)
                .body("enabled", equalTo(true))
                .body("publicKey", notNullValue());
    }

    @Test
    void earlyDueAndRepeatedRemindersUntilTheLimit() throws Exception {
        reminders.tick(at.minus(9, ChronoUnit.MINUTES));
        List<Map<String, Object>> early = anaPhone.take();
        assertEquals(1, early.size());
        assertEquals("Dose em 10 min", early.getFirst().get("title"));
        assertEquals("dose-" + dose, early.getFirst().get("tag"));
        assertEquals("/doses/" + dose, early.getFirst().get("url"));
        assertEquals("high", early.getFirst().get("_urgency"));
        // Tela bloqueada sem detalhes por padrão: nem pessoa nem medicamento.
        String body = (String) early.getFirst().get("body");
        assertFalse(body.contains("Medicamento A") || body.contains("Gabriel"), body);
        assertEquals(1, brunoPhone.take().size());

        reminders.tick(at.minus(8, ChronoUnit.MINUTES)); // nada novo
        assertEquals(0, anaPhone.take().size());

        reminders.tick(at);
        assertEquals("Hora da dose", anaPhone.take().getFirst().get("title"));
        reminders.tick(at.plus(15, ChronoUnit.MINUTES));
        assertEquals("Dose pendente", anaPhone.take().getFirst().get("title"));
        reminders.tick(at.plus(45, ChronoUnit.MINUTES));
        assertEquals("Dose atrasada", anaPhone.take().getFirst().get("title"));
        reminders.tick(at.plus(60, ChronoUnit.MINUTES)); // 4ª e última repetição
        assertEquals(1, anaPhone.take().size());
        reminders.tick(at.plus(75, ChronoUnit.MINUTES));
        assertEquals(0, anaPhone.take().size());
    }

    @Test
    void detailsOnTheLockScreenOnlyWhenAllowed() throws Exception {
        Map<String, Object> prefs = preferences(true, false);
        d.ana.req().body(prefs).put("/api/me/notification-settings").then().statusCode(200);
        reminders.tick(at);
        assertTrue(((String) anaPhone.take().getFirst().get("body")).contains("Gabriel · Medicamento A · 5 ml"));
        assertFalse(((String) brunoPhone.take().getFirst().get("body")).contains("Medicamento A"));
    }

    @Test
    void registeringTheDoseStopsRemindersAndReplacesTheNotice() throws Exception {
        reminders.tick(at);
        anaPhone.take();
        brunoPhone.take();

        d.ana.req().body(Map.of("deviceId", d.anaDevice)).post("/api/families/{f}/occurrences/{o}/administration",
                d.family, dose).then().statusCode(200);
        outbox.publish(Instant.now());

        Map<String, Object> replaced = brunoPhone.take().getFirst();
        assertEquals("Dose registrada", replaced.get("title"));
        assertEquals("dose-" + dose, replaced.get("tag"));
        assertEquals(true, replaced.get("silent"), "confirmação de rotina não toca por padrão");
        assertTrue(((String) replaced.get("body")).startsWith("Ana registrou"));

        // Quem registrou também tinha o lembrete: ele é substituído em silêncio nos aparelhos dela.
        Map<String, Object> own = anaPhone.take().getFirst();
        assertEquals("dose-" + dose, own.get("tag"));
        assertEquals(true, own.get("silent"));

        reminders.tick(at.plus(15, ChronoUnit.MINUTES));
        assertEquals(0, brunoPhone.take().size());
        assertEquals(0, anaPhone.take().size());
    }

    @Test
    void routineConfirmationOnlyForWhoAskedForIt() throws Exception {
        d.bruno.req().body(preferences(false, true)).put("/api/me/notification-settings").then().statusCode(200);
        d.ana.req().body(Map.of("deviceId", d.anaDevice)).post("/api/families/{f}/occurrences/{o}/administration",
                d.family, dose).then().statusCode(200);
        outbox.publish(Instant.now());

        Map<String, Object> confirmation = brunoPhone.take().getFirst();
        assertEquals("Dose registrada", confirmation.get("title"));
        assertEquals(false, confirmation.get("silent"));
        assertEquals(0, anaPhone.take().size(), "quem registrou não recebe confirmação");
    }

    @Test
    void claimingTheDoseSilencesTheOthers() throws Exception {
        Instant soon = d.now.plus(3, ChronoUnit.MINUTES);
        String soonDose = createDoseAt(soon);
        d.bruno.req().post("/api/families/{f}/occurrences/{o}/claim", d.family, soonDose).then().statusCode(200)
                .body("claimedBy.displayName", equalTo("Bruno"))
                .body("claimedUntil", notNullValue());
        d.ana.req().post("/api/families/{f}/occurrences/{o}/claim", d.family, soonDose).then().statusCode(409)
                .body("code", equalTo("ALREADY_CLAIMED"));

        reminders.tick(soon);
        assertEquals(0, anaPhone.take().stream().filter(m -> ("dose-" + soonDose).equals(m.get("tag"))).count());
        assertEquals(1, brunoPhone.take().stream().filter(m -> ("dose-" + soonDose).equals(m.get("tag"))).count());
    }

    @Test
    void snoozeDelaysOnlyTheRemindersOfWhoAskedAndNotTheDose() throws Exception {
        Instant later = at.plus(30, ChronoUnit.MINUTES);
        d.ana.req().body(Map.of("remindAt", later.toString()))
                .put("/api/families/{f}/occurrences/{o}/snooze", d.family, dose).then().statusCode(200)
                .body("remindAt", notNullValue());
        d.bruno.req().get("/api/families/{f}/occurrences/{o}", d.family, dose).then().statusCode(200)
                .body("occurrence.remindAt", nullValue());

        reminders.tick(at);
        assertEquals(0, anaPhone.take().size());
        assertEquals("Hora da dose", brunoPhone.take().getFirst().get("title"));
        reminders.tick(at.plus(15, ChronoUnit.MINUTES));
        assertEquals(0, anaPhone.take().size());
        brunoPhone.take();
        reminders.tick(later);
        assertEquals(1, anaPhone.take().size());
        reminders.tick(later.plus(1, ChronoUnit.MINUTES));
        assertEquals(0, anaPhone.take().size(), "o lembrete adiado vai uma vez só");
        reminders.tick(at.plus(45, ChronoUnit.MINUTES));
        assertEquals("Dose atrasada", anaPhone.take().getFirst().get("title"), "a agenda segue no horário original");

        // Cancelar volta à agenda; adiar de novo numera outro lembrete.
        d.ana.req().delete("/api/families/{f}/occurrences/{o}/snooze", d.family, dose).then().statusCode(200)
                .body("remindAt", nullValue());
        d.ana.req().body(Map.of("remindAt", Instant.now().plus(13, ChronoUnit.HOURS).toString()))
                .put("/api/families/{f}/occurrences/{o}/snooze", d.family, dose).then().statusCode(422)
                .body("code", equalTo("SNOOZE_TOO_LONG"));
    }

    @Test
    void snoozeFromTheOfflineQueueAfterTheDoseWasDecidedChangesNothing() throws Exception {
        d.bruno.req().body(Map.of("deviceId", d.brunoDevice)).post("/api/families/{f}/occurrences/{o}/administration",
                d.family, dose).then().statusCode(200);
        d.ana.req().body(Map.of("remindAt", at.plus(30, ChronoUnit.MINUTES).toString()))
                .put("/api/families/{f}/occurrences/{o}/snooze", d.family, dose).then().statusCode(200)
                .body("status", equalTo("ADMINISTERED"))
                .body("remindAt", nullValue());
        // Hora pedida já passou (enviado tarde pela fila): nada a adiar.
        d.ana.req().body(Map.of("remindAt", Instant.now().minus(1, ChronoUnit.MINUTES).toString()))
                .put("/api/families/{f}/occurrences/{o}/snooze", d.family, dose).then().statusCode(200);
    }

    @Test
    void quietHoursAreRespected() throws Exception {
        Map<String, Object> prefs = preferences(false, false);
        prefs.put("quietHoursEnabled", true);
        prefs.put("quietHoursStart", "00:00");
        prefs.put("quietHoursEnd", "23:59");
        d.ana.req().body(prefs).put("/api/me/notification-settings").then().statusCode(200);
        reminders.tick(at);
        assertEquals(0, anaPhone.take().size());
        assertEquals(1, brunoPhone.take().size());
    }

    @Test
    void expiredSubscriptionIsDisabled() throws Exception {
        server.respondWith(brunoPhone, 410);
        reminders.tick(at);
        brunoPhone.take();
        PushSubscription sub = QuarkusTransaction.requiringNew().call(() ->
                PushSubscription.<PushSubscription>find("deviceId", d.brunoDevice).firstResult());
        assertNotNull(sub.disabledAt);
        reminders.tick(at.plus(15, ChronoUnit.MINUTES));
        assertEquals(0, brunoPhone.take().size());
    }

    @Test
    void staleRemindersAreNotSentLate() throws Exception {
        reminders.tick(at.plus(3, ChronoUnit.HOURS));
        assertEquals(0, anaPhone.take().size());
    }

    @Test
    void conflictsAlwaysNotifyEveryone() throws Exception {
        d.ana.req().body(Map.of("deviceId", d.anaDevice, "operationId", UUID.randomUUID(), "baseVersion", 1))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, dose).then().statusCode(200);
        d.bruno.req().body(Map.of("deviceId", d.brunoDevice, "operationId", UUID.randomUUID(), "baseVersion", 1))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, dose).then().statusCode(200)
                .body("status", equalTo("REVIEW_REQUIRED"));
        outbox.publish(Instant.now());

        for (Browser phone : List.of(anaPhone, brunoPhone)) {
            Map<String, Object> conflict = phone.take().stream()
                    .filter(m -> "Registros divergentes".equals(m.get("title"))).findFirst().orElseThrow();
            assertEquals("high", conflict.get("_urgency"));
        }
    }

    @Test
    void customReminderToCreatorOrEveryone() throws Exception {
        Instant remindAt = Instant.now().plus(1, ChronoUnit.MINUTES);
        d.ana.req().body(Map.of("message", "Medir a temperatura de novo", "remindAt", remindAt.toString()))
                .post("/api/families/{f}/persons/{p}/reminders", d.family, d.person).then().statusCode(200);
        d.ana.req().body(Map.of("message", "Trocar o curativo", "remindAt", remindAt.toString(), "notifyEveryone", true))
                .post("/api/families/{f}/persons/{p}/reminders", d.family, d.person).then().statusCode(200);
        d.ana.req().get("/api/families/{f}/persons/{p}/reminders", d.family, d.person).then().body("size()", equalTo(2));

        reminders.tick(remindAt.plus(1, ChronoUnit.MINUTES));
        assertEquals(2, anaPhone.take().stream().filter(m -> "Lembrete".equals(m.get("title"))).count());
        assertEquals(1, brunoPhone.take().stream().filter(m -> "Lembrete".equals(m.get("title"))).count());
        d.ana.req().get("/api/families/{f}/persons/{p}/reminders", d.family, d.person).then().body("size()", equalTo(0));
    }

    @Test
    void revokedDeviceStopsReceiving() throws Exception {
        d.bruno.req().delete("/api/me/devices/{d}", d.brunoDevice).then().statusCode(204);
        reminders.tick(at);
        assertEquals(0, brunoPhone.take().size());
        assertEquals(1, anaPhone.take().size());
    }

    @Test
    void asNeededDoseNotifiesTheOthersWithTheCountOfTheLast24Hours() throws Exception {
        String t = d.ana.req().body(AsNeededTest.asNeeded(d.person, d.now.minus(1, ChronoUnit.DAYS)))
                .post("/api/families/{f}/treatments", d.family).then().statusCode(201).extract().path("id");
        d.activate(t, 1, d.now);
        outbox.publish(Instant.now().plus(1, ChronoUnit.DAYS));
        anaPhone.take();
        brunoPhone.take();

        for (int minutesAgo : new int[] {30 * 60, 6 * 60, 0}) { // a de 30 h atrás não entra na conta
            d.ana.req().body(Map.of("deviceId", d.anaDevice.toString(),
                    "administeredAt", d.now.minus(minutesAgo, ChronoUnit.MINUTES).toString()))
                    .post("/api/families/{f}/treatments/{t}/doses", d.family, t).then().statusCode(200);
        }
        outbox.publish(Instant.now().plus(1, ChronoUnit.DAYS));
        List<Map<String, Object>> toBruno = brunoPhone.take();
        assertEquals(3, toBruno.size());
        List<String> bodies = toBruno.stream().map(m -> (String) m.get("body")).toList();
        assertTrue(toBruno.stream().allMatch(m -> "Dose registrada".equals(m.get("title"))), toBruno.toString());
        assertTrue(bodies.stream().anyMatch(b -> b.contains("2 doses nas últimas 24 h")), bodies.toString());
        // Tela bloqueada sem detalhes por padrão.
        assertTrue(bodies.stream().noneMatch(b -> b.contains("Paracetamol") || b.contains("Gabriel")), bodies.toString());
        assertEquals(0, anaPhone.take().size(), "quem registrou não é avisado");
    }

    @Test
    void testNotificationAndUnsubscribe() throws Exception {
        d.ana.req().post("/api/me/push/test").then().statusCode(200).body("sent", equalTo(1));
        assertEquals("Notificações ativadas", anaPhone.take().getFirst().get("title"));
        d.ana.req().delete("/api/me/devices/{d}/push", d.anaDevice).then().statusCode(204);
        d.ana.req().post("/api/me/push/test").then().statusCode(422).body("code", equalTo("NO_SUBSCRIPTION"));
    }

    private Browser subscribe(Api.User user, UUID device) throws Exception {
        Browser browser = server.browser();
        user.req().body(browser.subscription("UTC")).put("/api/me/devices/{d}/push", device).then().statusCode(200);
        return browser;
    }

    private String createDoseAt(Instant time) {
        String t = d.createTreatment(Dosing.dailyAt(time));
        d.activate(t, 1, d.now);
        return d.occurrenceAt(time);
    }

    private static Map<String, Object> preferences(boolean lockScreenDetails, boolean confirmations) {
        Map<String, Object> p = new HashMap<>();
        p.put("soundEnabled", true);
        p.put("vibrationEnabled", true);
        p.put("earlyReminderEnabled", true);
        p.put("confirmationNotifications", confirmations);
        p.put("quietHoursEnabled", false);
        p.put("syncNoticeMode", "NOTIFY");
        p.put("lockScreenDetails", lockScreenDetails);
        return p;
    }

    private static void assertNotNull(Object value) {
        org.junit.jupiter.api.Assertions.assertNotNull(value);
    }
}
