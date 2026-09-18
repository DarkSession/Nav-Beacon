import { Injectable, inject } from '@angular/core';
import { BuildLinkCodecError } from '../../domain/build-link/build-link-codec-error';
import { CATALOGUE_MOUNTS } from '../../domain/equipment/loadout/loadout-mounts';
import { GameTextPresenter } from '../../i18n/game-text.presenter';
import { MessageService } from '../../i18n/message.service';
import type { MessageKey } from '../../i18n/locale-registry';
import type { LinkFailureCode } from '../active-build/active-build.models';

export type { LinkFailureCode };

/** One failure, in the terms the presentation layer works with. */
export interface LinkFailure {
  readonly code: LinkFailureCode;
  /** The game slot key the codec named, when it named one. */
  readonly slot: string | null;
}

/** Which codec refused, because two codes read wrongly for the other one. */
export type LinkTool = 'ship' | 'equipment';

/** A failure, said in the Commander's language. */
export interface LinkFailureText {
  readonly message: string;
  /** Which mount is involved, when the codec could say. */
  readonly detail: string | null;
}

/**
 * Every reason a link failed, in one place, keyed by a stable code.
 *
 * A `BuildLinkCodecError` message is an internal English string written for
 * whoever is reading a stack trace. None of them is ever rendered: they name
 * table versions, bit widths and canonical forms, they are not translated, and
 * they would tell a Commander nothing they could act on (build-link contract,
 * "Error presentation").
 */
/**
 * The codes whose ship wording is wrong for a loadout.
 *
 * The rest read the same either way — an altered fragment is an altered
 * fragment — so only these are said twice (013
 * contracts/equipment-loadout-link.md, "Refusal wording").
 *
 * `unsupportedTableVersion` is among them for the same reason: the ship key
 * calls a loadout link a build link, and a payload naming a table this
 * application does not carry is a refusal a Commander meets.
 */
const EQUIPMENT_MESSAGE_KEYS: Partial<Record<LinkFailureCode, MessageKey>> = {
  invalidPayload: 'link.error.equipment.invalidPayload',
  unknownIdentity: 'link.error.equipment.unknownIdentity',
  unsupportedTableVersion: 'link.error.equipment.unsupportedTableVersion',
};

const MESSAGE_KEYS: Readonly<Record<LinkFailureCode, MessageKey>> = {
  invalidEncoding: 'link.error.invalidEncoding',
  integrityCheckFailed: 'link.error.integrityCheckFailed',
  unsupportedEnvelope: 'link.error.unsupportedEnvelope',
  unsupportedTableVersion: 'link.error.unsupportedTableVersion',
  invalidPayload: 'link.error.invalidPayload',
  unknownIdentity: 'link.error.unknownIdentity',
  reconstructionFailed: 'link.error.reconstructionFailed',
  tooLong: 'link.error.tooLong',
};

@Injectable({ providedIn: 'root' })
export class LinkErrorMapper {
  readonly #messages = inject(MessageService);
  readonly #gameText = inject(GameTextPresenter);

  /**
   * Classifies whatever was thrown.
   *
   * Anything that is not a codec error is a reconstruction failure: the link
   * was read but the build behind it could not be produced, which is precisely
   * what an unexpected exception on this path means.
   */
  classify(error: unknown): LinkFailure {
    if (error instanceof BuildLinkCodecError) {
      return { code: error.code, slot: error.slot };
    }
    return { code: 'reconstructionFailed', slot: null };
  }

  /**
   * The failure, in words, with the mount named where there is one.
   *
   * Which codec refused selects the wording: a loadout link that names a
   * missing identity is not naming "a hull or module", and a Commander told so
   * would go looking for the wrong thing.
   */
  describe(failure: LinkFailure, tool: LinkTool = 'ship'): LinkFailureText {
    const key =
      (tool === 'equipment' ? EQUIPMENT_MESSAGE_KEYS[failure.code] : null) ??
      MESSAGE_KEYS[failure.code];

    return {
      message: this.#messages.message(key),
      detail: tool === 'equipment' ? this.#mount(failure.slot) : this.#slot(failure.slot),
    };
  }

  #slot(slot: string | null): string | null {
    return slot === null ? null : this.#messages.message('link.refused.slot', { slot });
  }

  /**
   * The mount a refusal is about, named the way every other game noun is.
   *
   * `PrimaryWeapon1` is Frontier's journal key and never reaches a screen
   * (FR-021, constitution VI). The codec also names the suit itself, which is
   * not a mount and says so instead.
   */
  #mount(slot: string | null): string | null {
    if (slot === null) return null;

    const mount = CATALOGUE_MOUNTS.find((candidate) => candidate.key === slot) ?? null;
    if (mount === null) {
      return this.#messages.message('link.refused.suit');
    }
    return this.#messages.message('link.refused.mount', {
      mount: this.#gameText.personalMountName(mount).text ?? mount.key,
    });
  }
}
