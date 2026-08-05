# If not running interactively, don't do anything (leave this at the top of this file)
[[ $- != *i* ]] && return

# All the default Omarchy aliases and functions
# (don't mess with these directly, just overwrite them here!)
source ~/.local/share/omarchy/default/bash/rc

# Add your own exports, aliases, and functions here.
#
# Make an alias for invoking commands you use constantly
# alias p='python'
PATH="$HOME/bin:$PATH"
PATH="$HOME/.dotnet/tools:$PATH"
PATH="$HOME/bin/JetBrains.Rider-2025.3.3/bin:$PATH"

# other configurations
export SSH_AUTH_SOCK="$XDG_RUNTIME_DIR/ssh-agent.socket"

# aliases
alias 1rm='_1rm'
alias v=nvim
alias lg=lazygit
alias acme-list-secrets='~/src/secrets/acme/list-secrets.sh'
alias acme-secrets=acme-list-secrets
alias xa='~/src/snippets/linux/close-all-except.sh'
alias sb='source ~/.bashrc'
alias rdp=xfreerdp3

# restart waybar
alias wb='systemctl --user restart waybar.service'

# sources
source ~/bin/1rm

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/home/mbh/google-cloud-sdk/path.bash.inc' ]; then . '/home/mbh/google-cloud-sdk/path.bash.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/home/mbh/google-cloud-sdk/completion.bash.inc' ]; then . '/home/mbh/google-cloud-sdk/completion.bash.inc'; fi

# nvm
export NVM_DIR="$HOME/.nvm"

set -h # temporarily re-enable hashing
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

source /usr/share/nvm/init-nvm.sh
set +h # restore Omarchy's disabled hashing

# rider background launcher
riderd() {
  nohup rider "$@" >/dev/null 2>&1 &
}

# music stations
alias classical='mpv https://live.ideastream.org/wclv.mp3'
alias catholic='mpv http://traditionalcatholicradio.org:8000/main'

# toggl
alias toggl-projects='sqlite3 -header -column ~/src/bamboo/tools/src/toggl/toggl.db "SELECT id, name, client_name FROM toggl_projects WHERE active=1 ORDER BY client_name, name"'
alias toggl-pull='(cd ~/src/bamboo/tools/src/toggl && npm run --silent get-projects)'
alias tp=toggl-push
alias tpa='toggl-push --all'
alias arf=accrued-revenue-fresh

# opencode
export PATH=/home/mbh/.opencode/bin:$PATH

# tmux — override Omarchy tdl: editor + AI only (no bottom shell).
# Escape hatch for a terminal: M-Enter (vertical split). See MASTER-1972.
tdl() {
  [[ -z $1 ]] && { echo "Usage: tdl <c|cx|codex|other_ai> [<second_ai>]"; return 1; }
  [[ -z $TMUX ]] && { echo "You must start tmux to use tdl."; return 1; }

  local current_dir="${PWD}"
  local editor_pane ai_pane ai2_pane
  local ai="$1"
  local ai2="$2"

  editor_pane="$TMUX_PANE"
  tmux rename-window -t "$editor_pane" "$(basename "$current_dir")"

  # AI on the right, equal width (no bottom terminal pane)
  ai_pane=$(tmux split-window -h -p 50 -t "$editor_pane" -c "$current_dir" -P -F '#{pane_id}')

  if [[ -n $ai2 ]]; then
    ai2_pane=$(tmux split-window -v -t "$ai_pane" -c "$current_dir" -P -F '#{pane_id}')
    tmux send-keys -t "$ai2_pane" "$ai2" C-m
  fi

  tmux send-keys -t "$ai_pane" "$ai" C-m
  tmux send-keys -t "$editor_pane" "${EDITOR:-nvim} ." C-m
  tmux select-pane -t "$editor_pane"
}

# Machine-local, non-dotfiled exports (e.g. OPENCODE_IDLE_NTFY_TOPIC).
# This file is intentionally outside the dotfiles repo so secrets never get
# committed. Loaded last so it can override anything set above.
[[ -f ~/.bashrc.local ]] && source ~/.bashrc.local
