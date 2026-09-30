import type { Locale } from "@/features/i18n/locale";
import type { IconName } from "@/components/ui/Icon";

type Topic = "registered" | "queue" | "clarification" | "status" | "reply" | "authorReply" | "assigned" | "rerouted" | "showcase";
const copy: Record<Locale, Record<Topic, readonly [string, string, string]>> = {
  ru: {
    registered: ["Идея зарегистрирована", "Идея сохранена. В карточке можно следить за её рассмотрением.", "Открыть идею"],
    queue: ["Новая идея в очереди", "Для вашей организации поступило новое предложение. Откройте карточку для рассмотрения.", "Рассмотреть идею"],
    clarification: ["Нужны уточнения", "Специалист запросил дополнительную информацию. Посмотрите вопрос в карточке идеи.", "Посмотреть запрос"],
    status: ["Статус идеи изменён", "В карточке появились новые сведения о рассмотрении идеи.", "Посмотреть статус"],
    reply: ["Новый ответ по идее", "В диалоге появилось новое сообщение. Откройте его, чтобы прочитать ответ.", "Посмотреть ответ"],
    authorReply: ["Житель ответил", "Автор идеи добавил сообщение. Откройте карточку, чтобы продолжить диалог.", "Посмотреть ответ"],
    assigned: ["Вам назначена идея", "Вы назначены ответственным за рассмотрение предложения.", "Открыть идею"],
    rerouted: ["Направление идеи изменено", "Маршрут рассмотрения обновлён. Подробности доступны в карточке.", "Посмотреть направление"],
    showcase: ["Обновление идеи региона", "У публичной идеи, за которой вы следите, появилось обновление.", "Посмотреть обновление"],
  },
  kk: {
    registered: ["Идея тіркелді", "Идея сақталды. Оның қаралу барысын карточкадан бақылауға болады.", "Идеяны ашу"],
    queue: ["Кезекте жаңа идея", "Ұйымыңызға жаңа ұсыныс келіп түсті. Оны қарау үшін карточканы ашыңыз.", "Идеяны қарау"],
    clarification: ["Нақтылау қажет", "Маман қосымша ақпарат сұрады. Сұрақты идея карточкасынан қараңыз.", "Сұрауды қарау"],
    status: ["Идея мәртебесі өзгерді", "Карточкада идеяның қаралуы туралы жаңа мәліметтер бар.", "Мәртебені қарау"],
    reply: ["Идея бойынша жаңа жауап", "Диалогта жаңа хабарлама бар. Жауапты оқу үшін оны ашыңыз.", "Жауапты қарау"],
    authorReply: ["Тұрғын жауап берді", "Идея авторы хабарлама қосты. Диалогты жалғастыру үшін карточканы ашыңыз.", "Жауапты қарау"],
    assigned: ["Сізге идея тағайындалды", "Сіз ұсынысты қарауға жауапты маман болып тағайындалдыңыз.", "Идеяны ашу"],
    rerouted: ["Идея бағыты өзгерді", "Қарау бағыты жаңартылды. Толық ақпарат карточкада берілген.", "Бағытты қарау"],
    showcase: ["Өңір идеясының жаңартуы", "Сіз бақылайтын ашық идеяға жаңарту қосылды.", "Жаңартуды қарау"],
  },
  en: {
    registered: ["Idea registered", "Your idea has been saved. Follow its review in the idea details.", "Open idea"],
    queue: ["New idea in the queue", "Your organization received a new proposal. Open the details to review it.", "Review idea"],
    clarification: ["Clarification requested", "A specialist requested more information. Read the question in the idea details.", "View request"],
    status: ["Idea status changed", "New information about the review is available in the idea details.", "View status"],
    reply: ["New reply to your idea", "There is a new message in the conversation. Open it to read the reply.", "View reply"],
    authorReply: ["The resident replied", "The author added a message. Open the idea to continue the conversation.", "View reply"],
    assigned: ["An idea was assigned to you", "You have been assigned to review this proposal.", "Open idea"],
    rerouted: ["Idea routing changed", "The review route has been updated. Details are available in the idea.", "View routing"],
    showcase: ["Regional idea update", "There is an update to a public idea you follow.", "View update"],
  },
};
const topics: Record<string, { topic: Topic; icon: IconName }> = {
  IDEA_REGISTERED: { topic: "registered", icon: "bulb" },
  CLARIFICATION_REQUESTED: { topic: "clarification", icon: "file" },
  NEEDS_INFO: { topic: "clarification", icon: "file" },
  STATUS_CHANGED: { topic: "status", icon: "layers" }, STATUS: { topic: "status", icon: "layers" },
  PUBLIC_REPLY: { topic: "reply", icon: "mail" }, ASSIGNED: { topic: "assigned", icon: "user" },
  REROUTED: { topic: "rerouted", icon: "arrow" }, SHOWCASE_UPDATE: { topic: "showcase", icon: "globe" },
};

export const notificationLabels: Record<Locale, { unread: string; read: string; mark: string; marking: string }> = {
  ru: { unread: "Новое", read: "Прочитано", mark: "Отметить прочитанным", marking: "Отмечаем…" },
  kk: { unread: "Жаңа", read: "Оқылды", mark: "Оқылған деп белгілеу", marking: "Белгілеу…" },
  en: { unread: "New", read: "Read", mark: "Mark as read", marking: "Marking…" },
};

export function notificationPresentation(notification: { kind?: string; title: string }, staff: boolean, locale: Locale) {
  const mapped = topics[notification.kind ?? ""];
  const publicNumber = notification.title.match(/\bABAI-\d{4}-\d{6,}\b/u)?.[0] ?? null;
  const publicationCopy: Record<Locale, Record<string, readonly [string, string, string]>> = {
    ru: {
      pending: ["Нужна проверка публикации", "Автор подготовил публичную карточку и дал согласие. Проверьте текст, чтобы идея появилась в общей ленте.", "Проверить публикацию"],
      published: ["Идея появилась в «Идеях региона»", "Сотрудник проверил публичную карточку. Теперь её видят жители региона.", "Открыть идею"],
      rejected: ["Публикацию нужно уточнить", "Сотрудник вернул карточку на подготовку. Прочитайте комментарий и обновите публичный текст.", "Уточнить публикацию"],
    },
    kk: {
      pending: ["Жарияланымды тексеру қажет", "Автор ашық карточканы дайындап, келісім берді. Идея жалпы таспада көрінуі үшін мәтінді тексеріңіз.", "Жарияланымды тексеру"],
      published: ["Идея өңір таспасында жарияланды", "Қызметкер ашық карточканы тексерді. Енді оны өңір тұрғындары көре алады.", "Идеяны ашу"],
      rejected: ["Жарияланымды нақтылау қажет", "Қызметкер карточканы қайта дайындауға қайтарды. Пікірін оқып, ашық мәтінді жаңартыңыз.", "Жарияланымды нақтылау"],
    },
    en: {
      pending: ["Publication review needed", "The author prepared a public card and consented. Review its text to make it visible in the regional feed.", "Review publication"],
      published: ["Your idea is in the regional feed", "A staff member reviewed the public card. Residents can now see it.", "Open idea"],
      rejected: ["Publication needs revision", "A staff member returned the card for preparation. Read the note and update the public text.", "Revise publication"],
    },
  };
  const publication = notification.kind === "PUBLIC_REPLY" ? notification.title.includes("нужна проверка публикации") ? "pending" : notification.title.includes("опубликована в «Идеях региона»") ? "published" : notification.title.includes("публикация возвращена на подготовку") ? "rejected" : null : null;
  if (publication) {
    const [title, description, action] = publicationCopy[locale][publication]!;
    return { title, description, action, icon: "globe" as IconName, publicNumber };
  }
  if (!mapped) return { title: notification.title, description: "", action: copy[locale].registered[2], icon: "bell" as IconName, publicNumber };
  let topic = mapped.topic;
  if (topic === "registered" && staff) topic = "queue";
  if (topic === "reply" && staff && notification.title.includes("ответ автора")) topic = "authorReply";
  const [title, description, action] = copy[locale][topic];
  return { title, description, action, icon: mapped.icon, publicNumber };
}
