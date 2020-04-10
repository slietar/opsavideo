const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const path = require('path');
const production = process.env.NODE_ENV == 'production';

module.exports = {
  mode: production ? 'production' : 'development',
  entry: './src/main.jsx',
  module: {
    rules: [
      {
        test: /\.jsx$/,
        include: [ path.resolve(__dirname, "src") ],
        use: {
          loader: 'babel-loader',
          options: {
            'plugins': [
              '@babel/plugin-syntax-jsx',
              ['@babel/plugin-transform-react-jsx', { 'pragma': 'createElement', 'pragmaFrag': 'Fragment' }]
            ]
          }
        }
      },
      {
        test: /\.scss$/,
        include: [ path.resolve(__dirname, "styles") ],
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          'sass-loader',
          {
            loader: 'sass-loader',
            options: {
              implementation: require('sass'),
            },
          },
        ],
      }
    ]
  },
  plugins: [
    new CleanWebpackPlugin(),
    new MiniCssExtractPlugin(),
    new HtmlWebpackPlugin({
      hash: true,
      template: './index.html'
    })
  ],
  output: {
    filename: 'main.js'
  },
  optimization: {
             minimize: false,
    concatenateModules: true
        }
}
