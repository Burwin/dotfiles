-- ~/.config/nvim/lua/plugins/markdown-preview.lua  (or wherever you put extras)
return {
  {
    "brianhuster/live-preview.nvim",
    dependencies = {
      -- Optional but strongly recommended for images
      "3rd/image.nvim",
    },
    build = function()
      require("livepreview").install()
    end,
    config = function()
      require("livepreview").setup({
        port = 9865, -- change if needed
        browser = "default", -- or "firefox", "brave", etc.
        sync_scroll = true,
        filetypes = { "markdown", "md", "rmd" },
      })

      -- Optional keymaps (add to which-key or wherever you like)
      vim.keymap.set("n", "<leader>mp", "<cmd>LivePreview toggle<cr>", { desc = "Toggle Markdown Preview" })
    end,
  },
}
