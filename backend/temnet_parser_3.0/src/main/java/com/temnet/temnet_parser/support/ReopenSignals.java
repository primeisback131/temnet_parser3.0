package com.temnet.temnet_parser.support;

import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Text signals the ticket state machine reads off a client's message that
 * arrives when no ticket is open: is it a bare acknowledgement ("спасибо")
 * that opens nothing, does it say the problem is back, or does it start a
 * new request? And whether an operator message written with no open ticket
 * asked or told the client something.
 * <p>
 * The word lists were fitted to the 2026 dump by two hand-read audits
 * (2026-09-30): about 300 openers and absorbed messages for the
 * acknowledgements, about 400 would-be merges for {@link #startsNewRequest}.
 */
public final class ReopenSignals {

    /** Words that say the previous problem is back; a standalone «нет» too. */
    private static final Pattern REOPEN_MARKERS = Pattern.compile(
            "опять|снова|не помог|та же|тот же|всё ещё|все еще|повторн|прежнему|так и не"
                    + "|не реш[её]н|не исправ|^нет[.!]*$");

    /** Words of a bare acknowledgement. */
    private static final Pattern ACK = Pattern.compile(
            "\\b(спасибо|спс|благодарю|благодарим|ок|окей|оки|хорошо|понял|поняла|понятно|принято|отлично"
                    + "|супер|ага|угу|да)\\b",
            Pattern.UNICODE_CHARACTER_CLASS);

    /** A negated phrase («не ок», «спасибо, не надо») is not an acknowledgement. */
    private static final Pattern NEGATION = Pattern.compile("\\bне\\b", Pattern.UNICODE_CHARACTER_CLASS);

    /** A message this short cannot describe a problem: "+", "ok", an emoji. */
    private static final int ACK_MAX_LENGTH = 5;

    /**
     * A question, a request or a complaint: «Спасибо! Можно еще папку
     * установить», «Да. Вопрос, почему…». Before 2026-09-30 such messages
     * were swallowed as thanks whenever they also said «спасибо» or «да».
     */
    private static final Pattern REQUEST = Pattern.compile(
            "подскаж|скажите|объясн|можно(?!\\s+закры)|нужн|надо|необходим|требует|помоги|помож|настройте"
                    + "|установите|подключите|сделайте|посмотрите|проверьте|отпишит|пришлите|скиньте|перезвон"
                    + "|позвоните|добавьте|удалите|восстанов|верните|дайте|откройте|включите|выключите|отключите"
                    + "|замените|почините|исправьте|ошибк|проблем|завис|сломал|перестал|глюч|тормоз|пропал|почему"
                    + "|зачем|когда|\\bгде\\b|куда|сколько|какой|какая|какие|\\bкак\\b|\\bещ[её]\\b(?!\\s+раз)"
                    + "|(^|[\\s,.!;])а\\s|\\bнет\\b|\\bне\\b|плохо|медленно|грязно|бледно|криво|долго|пятн|полос",
            Pattern.UNICODE_CHARACTER_CLASS);

    /** Longer than this, an acknowledgement is carrying something else. */
    private static final int ACK_TEXT_MAX_LENGTH = 60;

    /**
     * Words of a pure acknowledgement, typos included: «спсаибо», «Cпасибо»
     * with a Latin C, «спасибки», «Благодарствую», «Всё работает», and
     * «cgfcb,j» - «спасибо» typed in the English layout.
     */
    private static final Pattern PURE_ACK = Pattern.compile(
            "спасиб|спс|благодар|мерси|пасиб|thank|thx|cgfcb|\\bок\\b|\\bокей\\b|\\bоки\\b|\\bok\\b|okay|хорошо"
                    + "|\\bпонял|понятно|принято|принял|отлично|супер|\\bага\\b|\\bугу\\b|\\bда\\b|\\bясно\\b|ладно"
                    + "|договорились|заработал|вс[её]\\s+(ок|хорошо|работает|получилось|норм)|получилось|получил"
                    + "|\\bвижу\\b|увидел|дошло|класс|круто|вошла|вошел|вошёл|спасли|решилось|решено",
            Pattern.UNICODE_CHARACTER_CLASS);

    private static final Pattern THANKS = Pattern.compile("спасиб|спс|благодар|мерси|пасиб|thank|thx|cgfcb");

    /** A word, as the audits counted them. */
    private static final Pattern WORD = Pattern.compile("[a-zа-яё0-9]+");

    /** An imperative new request: «установите», «прошу», «нужно настроить». */
    private static final Pattern NEW_REQUEST = Pattern.compile(
            "прошу|просьба|настройте|установите|подключите|сделайте|добавьте|удалите|поставьте|выдайте"
                    + "|включите|создайте|поменяйте|замените|перенесите|откройте доступ"
                    + "|нужн[аоы]? (установить|настроить|подключить|сделать)");

    /** The old problem is still there: «не», «ничего», «всё равно», «как закрыта». */
    private static final Pattern STILL_BROKEN = Pattern.compile(
            "\\bне\\b|опять|снова|ничего|вс[её] равно|так и|по-прежнему|ошибк|перестал|пропал|как закрыт"
                    + "|ещ[её] раз",
            Pattern.UNICODE_CHARACTER_CLASS);

    private static final Pattern GREETING = Pattern.compile(
            "^\\W*(здравствуйте|здраствуйте|здравствуй|добрый|доброе|доброго|привет|приветствую|хай)",
            Pattern.UNICODE_CHARACTER_CLASS);

    /** Longer than this, a message after a closure is a new story, not a follow-up. */
    private static final int FOLLOW_UP_MAX_LENGTH = 200;

    /** Client-side words that carry no request: greetings, thanks, pleasantries. */
    private static final Set<String> CHITCHAT = Set.of((
            "спасибо спасиб спасибки спасибочки пасиб пасибо спс благодарю благодарим мерси ок окей оки ok хорошо"
                    + " понял поняла понятно принято отлично супер ага угу да ладно ясно большое огромное вам вас"
                    + " тебе всё все всем очень и за помощь добрый доброе день утро вечер здравствуйте привет"
                    + " пожалуйста пж пжл коллеги ребята девочки хорошего доброго всего дня вечера до свидания пока"
                    + " взаимно тоже уже").split(" "));

    /** Operator-side words that carry nothing for the client to act on. */
    private static final Set<String> COURTESY = Set.of((
            "пожалуйста пожалуйсто пожалуста пож пжл обращайтесь обращайся рады рад рада помочь всего доброго"
                    + " хорошего дня вечера не за что до свидания спасибо вам вас и тоже взаимно ок хорошо да если"
                    + " будут возникнут вопросы всегда на связи здравствуйте добрый день утро вечер пишите")
            .split(" "));

    private ReopenSignals() {
    }

    /** True when the text says the previous problem persists. */
    public static boolean isReopenMarker(String text) {
        return REOPEN_MARKERS.matcher(text.strip().toLowerCase()).find();
    }

    /**
     * True for a bare acknowledgement of a closure, taken as thanks shortly
     * after it. A message carrying a reopen marker or a negation is never
     * one: «не помогло» is exactly ten characters long and used to be
     * swallowed by a pure length rule. Neither is anything request-like or
     * longer than {@value #ACK_TEXT_MAX_LENGTH} characters.
     */
    public static boolean isAck(String text) {
        String trimmed = text.strip();
        String lower = trimmed.toLowerCase();
        if (isReopenMarker(lower) || NEGATION.matcher(lower).find()) {
            return false;
        }
        if (isRequest(trimmed) || trimmed.length() > ACK_TEXT_MAX_LENGTH) {
            return false;
        }
        return trimmed.length() <= ACK_MAX_LENGTH || ACK.matcher(lower).find();
    }

    /**
     * True for an acknowledgement that stays one however late it comes: a
     * short message of thanks or agreement words (typos tolerated), or of
     * emoji and «+» alone, with nothing request-like. «.», digits and «test»
     * are not acknowledgements.
     */
    public static boolean isPureAck(String text) {
        String trimmed = text.strip();
        String lower = trimmed.toLowerCase();
        if (trimmed.length() > ACK_TEXT_MAX_LENGTH || isReopenMarker(lower) || NEGATION.matcher(lower).find()
                || isRequest(trimmed)) {
            return false;
        }
        return PURE_ACK.matcher(lower).find() || symbolsOnly(trimmed, lower);
    }

    /** True when the text thanks: «спасибо», «благодарю», «спс» and their typos. */
    public static boolean hasThanksWord(String text) {
        return THANKS.matcher(text.toLowerCase()).find();
    }

    /**
     * True when a message that comes right after a closure starts a new
     * request rather than continuing the closed one: an imperative request or
     * a greeting with a topic and no sign that the old problem persists, or a
     * long message.
     */
    public static boolean startsNewRequest(String text) {
        String trimmed = text.strip();
        String lower = trimmed.toLowerCase();
        boolean marker = isReopenMarker(lower);
        if (marker || STILL_BROKEN.matcher(lower).find()) {
            return !marker && trimmed.length() > FOLLOW_UP_MAX_LENGTH;
        }
        boolean greetingWithTopic = GREETING.matcher(lower).find() && contentWords(lower, CHITCHAT) >= 2;
        return NEW_REQUEST.matcher(lower).find() || greetingWithTopic || trimmed.length() > FOLLOW_UP_MAX_LENGTH;
    }

    /**
     * True when an operator message asks or tells the client something: not
     * a closure phrase, not a bare «заявка в работе», not courtesy alone.
     */
    public static boolean isSubstantiveOperatorMessage(String text) {
        if (ClosurePhrase.statusOf(text) != null) {
            return false;
        }
        String lower = text.toLowerCase();
        if ((lower.contains("заявка в работе") || lower.contains("в работе заявка")) && lower.length() <= 25) {
            return false;
        }
        return text.contains("?") || contentWords(lower, COURTESY) >= 2;
    }

    private static boolean isRequest(String text) {
        return text.contains("?") || REQUEST.matcher(text.toLowerCase()).find();
    }

    /** Emoji, «+» or «)» without a single word or question mark. */
    private static boolean symbolsOnly(String text, String lower) {
        if (WORD.matcher(lower).find() || text.contains("?")) {
            return false;
        }
        return text.codePoints().anyMatch(c -> c == '+' || c == ')' || c > 0x2100);
    }

    private static int contentWords(String lower, Set<String> stop) {
        int count = 0;
        Matcher m = WORD.matcher(lower);
        while (m.find()) {
            if (!stop.contains(m.group())) {
                count++;
            }
        }
        return count;
    }
}
