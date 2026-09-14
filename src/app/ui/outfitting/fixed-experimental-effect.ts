import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { GameTextPresentation } from '../../i18n/game-text.presenter';
import { MessageService } from '../../i18n/message.service';
import { GameText } from '../components/game-text/game-text';

/** A fitted experimental effect that the package does not permit a Commander to edit. */
@Component({
  selector: 'ednb-fixed-experimental-effect',
  imports: [GameText],
  templateUrl: './fixed-experimental-effect.html',
  styleUrl: './fixed-experimental-effect.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedExperimentalEffect {
  readonly #messages = inject(MessageService);

  readonly effect = input.required<GameTextPresentation>();

  readonly legend = this.#messages.messageSignal('outfitting.engineering.effect.fixed');
  readonly description = this.#messages.messageSignal(
    'outfitting.engineering.effect.fixed-description',
  );
}
