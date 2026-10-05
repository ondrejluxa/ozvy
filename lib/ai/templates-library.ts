import type { PresetKey } from "../domain/segments/presets";

/**
 * Hand-written Czech templates used by the mock AI provider in Phase 0.
 * {{vozidlo}} is always used in an accusative position ("viděli vaši Škodu
 * Octavia", "postaráme o vaše auto") because the renderer produces accusative.
 */

export type TemplateTone = "standard" | "friendly" | "formal" | "short";

export const TEMPLATE_LIBRARY: Record<PresetKey, Record<TemplateTone, string>> = {
  no_visit_12m: {
    standard:
      "{{osloveni}} je to už přes rok, co jsme naposledy viděli {{vozidlo}}. Rádi vám najdeme termín na kontrolu nebo servis. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    friendly:
      "{{osloveni}} dlouho jsme se neviděli a rádi se zase postaráme o {{vozidlo}}. Naposledy jste u nás byli {{posledni_navsteva}}. Zavolejte a domluvíme termín, který vám sedí. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    formal:
      "{{osloveni}} dovolujeme si vás pozvat na servisní prohlídku. Vaše poslední návštěva u nás byla {{posledni_navsteva}}. Termín vám rádi nabídneme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    short: "{{osloveni}} {{vozidlo}} jsme neviděli přes rok. Termín na servis: {{telefon}}. {{servis}}. {{odhlaseni}}",
  },
  no_visit_6m: {
    standard:
      "{{osloveni}} od poslední návštěvy uběhlo přes půl roku. Rádi zkontrolujeme {{vozidlo}} a domluvíme termín, který vám vyhovuje. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    friendly:
      "{{osloveni}} rádi bychom zase viděli {{vozidlo}}. Naposledy jste u nás byli {{posledni_navsteva}}. Stačí zavolat a najdeme termín. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    formal:
      "{{osloveni}} připomínáme se po více než půl roce od vaší poslední návštěvy. Termín kontroly vozidla vám rádi nabídneme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    short:
      "{{osloveni}} půl roku od servisu, zkontrolujeme {{vozidlo}}? Volejte {{telefon}}. {{servis}}. {{odhlaseni}}",
  },
  no_visit_18m: {
    standard:
      "{{osloveni}} už je to nějaký čas, co jsme viděli {{vozidlo}}. Rádi vás zase uvidíme, termín na servis nebo kontrolu domluvíme po telefonu. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    friendly:
      "{{osloveni}} chybíte nám. Naposledy jste u nás byli {{posledni_navsteva}} a rádi se zase postaráme o {{vozidlo}}. Zavolejte, termín najdeme. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    formal:
      "{{osloveni}} rádi bychom vám znovu nabídli naše služby. Termín servisní prohlídky vám domluvíme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    short: "{{osloveni}} dlouho jsme neviděli {{vozidlo}}. Termín na servis: {{telefon}}. {{servis}}. {{odhlaseni}}",
  },
  regular_service_10_14: {
    standard:
      "{{osloveni}} blíží se čas na pravidelný servis. Poslední servis jsme dělali {{posledni_navsteva}}. Rádi přichystáme termín pro {{vozidlo}}. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    friendly:
      "{{osloveni}} je to zhruba rok od posledního servisu, takže je ideální čas na další. Rádi přichystáme termín pro {{vozidlo}}, stačí zavolat. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    formal:
      "{{osloveni}} dovolujeme si připomenout pravidelný servis. Poslední servis jsme prováděli {{posledni_navsteva}}. Termín vám rádi nabídneme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    short: "{{osloveni}} je čas na roční servis pro {{vozidlo}}. Termín: {{telefon}}. {{servis}}. {{odhlaseni}}",
  },
  tyre_last_season: {
    standard:
      "{{osloveni}} blíží se sezóna přezouvání. Loni jsme vám pneumatiky přezouvali a letos to rádi uděláme znovu. Termín domluvíme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    friendly:
      "{{osloveni}} je čas přezout. Zavolejte a zarezervujeme termín pro {{vozidlo}} dřív, než začnou fronty. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    formal:
      "{{osloveni}} nabízíme vám termín sezónního přezutí pneumatik. Rezervaci provedeme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    short: "{{osloveni}} přezutí pro {{vozidlo}}? Termín: {{telefon}}. {{servis}}. {{odhlaseni}}",
  },
  ac_18_24: {
    standard:
      "{{osloveni}} před létem se vyplatí servis klimatizace. Naposledy jsme ji u vás dělali {{posledni_navsteva}}. Termín domluvíme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    friendly:
      "{{osloveni}} ať vás v létě nepřekvapí horko v autě. Rádi zkontrolujeme klimatizaci, termín domluvíme po telefonu. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    formal:
      "{{osloveni}} nabízíme vám servis klimatizace před letní sezónou. Termín vám rádi nabídneme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    short: "{{osloveni}} servis klimatizace před létem? Termín: {{telefon}}. {{servis}}. {{odhlaseni}}",
  },
  valuable_lost: {
    standard:
      "{{osloveni}} patříte k našim dlouholetým zákazníkům a rádi bychom se zase postarali o {{vozidlo}}. Termín domluvíme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    friendly:
      "{{osloveni}} vážíme si toho, že k nám roky jezdíte. Rádi se zase postaráme o {{vozidlo}}, stačí zavolat. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    formal:
      "{{osloveni}} děkujeme za vaši dosavadní důvěru. Termín servisní prohlídky vám rádi nabídneme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    short: "{{osloveni}} rádi se zase postaráme o {{vozidlo}}. Termín: {{telefon}}. {{servis}}. {{odhlaseni}}",
  },
  regulars_stopped: {
    standard:
      "{{osloveni}} dříve jste k nám jezdili pravidelně a rádi bychom na to navázali. Termín pro {{vozidlo}} domluvíme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    friendly:
      "{{osloveni}} rádi bychom vás zase viděli. Naposledy jste u nás byli {{posledni_navsteva}}. Zavolejte a domluvíme termín pro {{vozidlo}}. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    formal:
      "{{osloveni}} děkujeme za vaše dřívější pravidelné návštěvy. Termín servisní prohlídky vám rádi nabídneme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    short: "{{osloveni}} termín pro {{vozidlo}}? Volejte {{telefon}}. {{servis}}. {{odhlaseni}}",
  },
  stk_approaching: {
    standard:
      "{{osloveni}} blíží se termín STK. Rádi připravíme {{vozidlo}} na technickou kontrolu. Termín domluvíme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    friendly:
      "{{osloveni}} za pár týdnů vás čeká STK. Rádi s přípravou pomůžeme, stačí zavolat. {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
    formal:
      "{{osloveni}} upozorňujeme na blížící se termín technické kontroly. Přípravu na STK vám rádi nabídneme na tel. {{telefon}}. {{servis}}. {{odhlaseni}}",
    short: "{{osloveni}} blíží se STK. Příprava: {{telefon}}. {{servis}}. {{odhlaseni}}",
  },
};
